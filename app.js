/**
 * ============================================================
 *  Dashboard CO₂ – Simulación de Control PI en Lazo Cerrado
 *  Trabajo Final Integrador · Tecnologías para la Automatización
 * ============================================================
 *
 *  ARQUITECTURA:
 *    Setpoint (800 ppm) → Error [s] → Controlador PI → PWM → Actuador
 *    → Planta (balance de masa volumétrico) → Sensor NDIR [s] → realimentación
 *
 *  MODELO MATEMÁTICO (Híbrido: Planta Física + Controlador en Segundos):
 *    - Sensor Ks = 0.0005 s/ppm → SETPOINT_S = 800 × 0.0005 = 0.4 s
 *    - Error invertido: error_s = lectura_sensor - setpoint (acción inversa)
 *    - Planta: balance de masa volumétrico real (V=150 m³)
 *      dC/dt = [G×10⁶ − Q_out×(C−C_ext)] / (V×3600)
 *
 *  MÉTODO NUMÉRICO: Integración de Euler (Δt = 1 s, T = 10 800 s = 3 h)
 *  ANTI-WINDUP: Clamping (detiene la integración cuando PWM satura)
 * ============================================================
 */

'use strict';

// ── Referencias a elementos del DOM ──────────────────────────
let inputKp, inputKi, inputAlumnos, inputQmax;
let btnVentana;

// ── Estado de la perturbación ambiental ──────────────────────
/** Suma total del caudal extra de extracción por puertas/ventanas abiertas (m³/h) */
let caudalPerturbacion = 0;

// ── Instancias de Chart.js ───────────────────────────────────
let chartCO2, chartPWM;

// ── Debounce timer para el recálculo automático ──────────────
let debounceTimer = null;

/* ============================================================
   CONSTANTES DE SIMULACIÓN
   ============================================================ */
const SIM = Object.freeze({
    dt:           1,       // Paso de tiempo [s]
    T_TOTAL:      10800,   // Duración total: 3 horas [s]
    T_TOTAL_MIN:  180,     // Duración total [min] – para eje X
    CO2_EXT:      400,     // CO₂ base exterior [ppm]
    PWM_MAX:      255,     // Saturación superior del actuador
    MUESTRA_CADA: 15,      // Guardar un punto cada N segundos (→ 720 pts)
    // ── Parámetros de la planta física ─────────────────────
    V_AULA:       150,     // Volumen del aula [m³]
    G_ALUMNO:     0.015,   // Generación de CO₂ puro por alumno [m³/h]
});

/* ============================================================
   INIT – Se ejecuta cuando el DOM está listo
   ============================================================ */
function init() {
    // Capturar elementos
    inputKp      = document.getElementById('kp');
    inputKi      = document.getElementById('ki');
    inputAlumnos = document.getElementById('alumnos');
    inputQmax    = document.getElementById('qmax');
    btnVentana   = document.getElementById('btn-ventana');

    // ── Configurar sliders ────────────────────────────
    // Kp y Ki son enteros (error en segundos → ganancias grandes)
    configurarSlider(inputKp,      'kp-val',      v => Math.round(v).toString());
    configurarSlider(inputKi,      'ki-val',      v => Math.round(v).toString());
    configurarSlider(inputAlumnos, 'alumnos-val', v => Math.round(v).toString());
    configurarSlider(inputQmax,    'qmax-val',    v => Math.round(v).toString());

    // Configuración de Chart.js (modo oscuro)
    if (typeof Chart === 'undefined') {
        console.error('Chart.js no se cargó correctamente.');
        alert('Error: Chart.js no se cargó. Revisa tu conexión a internet.');
        return;
    }
    Chart.defaults.color       = '#8a9dc0';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.07)';

    // Primera ejecución
    ejecutarSimulacion();
}

/* ============================================================
   CONFIGURAR SLIDER
   Asocia 'input' (badge + track fill) y 'change' (recálculo).
   ============================================================ */
function configurarSlider(input, badgeId, formatter) {
    const badge = document.getElementById(badgeId);

    // Mientras se arrastra: actualizar badge y relleno visual del track
    input.addEventListener('input', () => {
        badge.innerText = formatter(parseFloat(input.value));
        updateSliderTrack(input);
    });

    // Al soltar el slider: recalcular la simulación automáticamente
    input.addEventListener('change', () => {
        scheduleRecalc();
    });

    // Estado inicial
    badge.innerText = formatter(parseFloat(input.value));
    updateSliderTrack(input);
}

/* ============================================================
   SLIDER TRACK FILL (Webkit)
   Aplica un gradiente de fondo dinámico que simula el "fill"
   del lado izquierdo del thumb (no disponible nativamente en Webkit).
   Firefox lo maneja nativamente con ::-moz-range-progress.
   ============================================================ */
function updateSliderTrack(input) {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const val = parseFloat(input.value);
    const pct = ((val - min) / (max - min)) * 100;
    input.style.background =
        `linear-gradient(to right,
            #4f8ef7 0%,
            #4f8ef7 ${pct}%,
            rgba(255,255,255,0.08) ${pct}%,
            rgba(255,255,255,0.08) 100%)`;
}

/* ============================================================
   RECÁLCULO CON DEBOUNCE
   Evita renders dobles si 'input' y 'change' disparan juntos.
   ============================================================ */
function scheduleRecalc() {
    clearTimeout(debounceTimer);
    mostrarIndicadorRecalc(true);
    debounceTimer = setTimeout(() => {
        ejecutarSimulacion();
        mostrarIndicadorRecalc(false);
    }, 80);
}

function mostrarIndicadorRecalc(activo) {
    const indicator = document.getElementById('recalcIndicator');
    if (!indicator) return;
    activo ? indicator.classList.add('active')
           : indicator.classList.remove('active');
}

/* ============================================================
   TOGGLE PERTURBACIONES
   Al activarse, agregan un caudal de extracción (m³/h) 
   simulando ventilación natural cruzada o directa.
   ============================================================ */
let perturbacionesActivas = {
    'puerta': false,
    'ventana-f': false,
    'ventana-t': false
};

window.togglePerturbacion = function (id, caudal) {
    perturbacionesActivas[id] = !perturbacionesActivas[id];
    
    if (perturbacionesActivas[id]) {
        caudalPerturbacion += caudal;
    } else {
        caudalPerturbacion -= caudal;
    }

    const btn = document.getElementById(`btn-${id}`);
    const textEl = document.getElementById(`btn-${id}-text`);
    const isPuerta = id === 'puerta';
    const nombre = isPuerta ? 'Puerta' : (id === 'ventana-f' ? 'Ventana Frontal' : 'Ventanas Traseras');

    if (perturbacionesActivas[id]) {
        btn.classList.add('active');
        textEl.innerText = `Cerrar ${nombre} (${caudal} m³/h)`;
    } else {
        btn.classList.remove('active');
        textEl.innerText = `Abrir ${nombre} (${caudal} m³/h)`;
    }

    // Recalcular inmediatamente al cambiar este parámetro
    scheduleRecalc();
};

/* ============================================================
   EJECUTAR SIMULACIÓN
   Motor principal: integración de Euler, paso a paso.
   Duración: 3 horas (10 800 s). Los alumnos están presentes
   desde el inicio (t = 0), formando parte de la condición
   de carga inicial de la planta.

   MODELO HÍBRIDO:
   - Controlador PI opera en SEGUNDOS (error_s = sensor_s - setpoint_s)
   - Planta usa el BALANCE DE MASA VOLUMÉTRICO real (150 m³)
   ============================================================ */
window.ejecutarSimulacion = function () {
    try {
        // ── Parámetros del controlador (leídos de la UI) ──────
        const Kp      = parseFloat(inputKp.value);
        const Ki      = parseFloat(inputKi.value);
        const alumnos = parseFloat(inputAlumnos.value);
        const Q_MAX   = parseFloat(inputQmax.value);

        // ── Arrays de salida para los gráficos ───────────────
        const tiempoArr   = [];
        const co2Arr      = [];
        const pwmArr      = [];
        const setpointArr = [];

        // ── Condiciones iniciales ─────────────────────────────
        let co2            = SIM.CO2_EXT;  // Aula con aire limpio al inicio
        let integral_error = 0;            // Acumulador del término integral

        // ── Caudal de inyección de CO₂ (constante, alumnos desde t=0) ──
        // G = G_alumno × N_alumnos  [m³/h de CO₂ puro]
        const flujo_in_CO2 = SIM.G_ALUMNO * alumnos;

        // ── Setpoint en segundos (constante) ──────────────────
        // Ks = 0.0005 s/ppm  →  800 ppm × 0.0005 = 0.4 s
        const SETPOINT_S = 800 * 0.0005; // 0.4 segundos

        // ════════════════════════════════════════════════════════
        //  BUCLE PRINCIPAL – Método de Euler (Δt = 1 s)
        // ════════════════════════════════════════════════════════
        for (let t = 0; t <= SIM.T_TOTAL; t += SIM.dt) {

            // ── 1. Sensor NDIR y Setpoint (Todo en SEGUNDOS) ──────
            // El sensor devuelve 0.5 ms por cada ppm = 0.0005 s/ppm
            const lectura_sensor_s = co2 * 0.0005;

            // ── 2. Punto Suma: Error Invertido (Acción Inversa) ──────
            // Como es un extractor, a mayor CO2 necesitamos mayor PWM.
            // Si sensor (1000ppm -> 0.5s) > Setpoint (800ppm -> 0.4s),
            // el error debe ser positivo (+0.1s).
            const error_s = lectura_sensor_s - SETPOINT_S;

            // ── 3. Controlador PI con Anti-Windup (Integración Condicional) ──
            // Primero, calculamos el PWM con la integral acumulada hasta el paso anterior
            let pwm = Kp * error_s + Ki * integral_error;

            // Guardamos el estado de saturación para pasar a la planta
            let pwm_saturado = pwm;
            if (pwm_saturado > SIM.PWM_MAX) {
                pwm_saturado = SIM.PWM_MAX;
            } else if (pwm_saturado < 0) {
                pwm_saturado = 0;
            }

            // ANTI-WINDUP: Actualizamos la integral para el *siguiente* ciclo SOLO si:
            // 1. NO estamos saturando por arriba mientras seguimos pidiendo más (error > 0)
            // 2. NO estamos saturando por abajo mientras seguimos pidiendo menos (error < 0)
            // Si estamos saturados pero el error va en reversa, SÍ permitimos integrar para "desatascar".
            if (!((pwm >= SIM.PWM_MAX && error_s > 0) || (pwm <= 0 && error_s < 0))) {
                integral_error += error_s * SIM.dt;
            }

            // El PWM que finalmente enviamos al actuador es el saturado
            pwm = pwm_saturado;

            // ── 4. Actuador: Caudal real de extracción (m³/h) ───────
            //    Transferencia lineal: Q_out = PWM × (Q_MAX / 255)
            let Q_out = pwm * (Q_MAX / SIM.PWM_MAX);

            //    Perturbación ambiental: suma de caudales por aberturas
            Q_out += caudalPerturbacion;

            // ── 5. PLANTA FÍSICA (Modelo Volumétrico Real) ───────
            //    Balance de masa en base al volumen del aula (150 m³)
            //    dC/dt = [G×10⁶ − Q_out×(C − C_ext)] / (V × 3600)
            //
            //    G en m³/h de CO₂ puro, Q_out en m³/h de aire,
            //    dividido por 3600 para convertir de /h a /s
            const inyeccion_ppm_s  = (flujo_in_CO2 * 1e6) / (SIM.V_AULA * 3600);
            const extraccion_ppm_s = (Q_out * (co2 - SIM.CO2_EXT)) / (SIM.V_AULA * 3600);
            const derivada_co2     = inyeccion_ppm_s - extraccion_ppm_s;

            // Integración de Euler: C(t+Δt) = C(t) + dC/dt × Δt
            co2 = co2 + derivada_co2 * SIM.dt;

            // Límite físico inferior: no puede bajar del nivel exterior
            if (co2 < SIM.CO2_EXT) co2 = SIM.CO2_EXT;

            // ── Muestreo: guardar cada MUESTRA_CADA segundos ──
            //    Reduce el total de puntos a ~720 para rendimiento
            if (t % SIM.MUESTRA_CADA === 0) {
                tiempoArr.push(t / 60);
                co2Arr.push(parseFloat(co2.toFixed(1)));
                pwmArr.push(parseFloat(pwm.toFixed(1)));
                setpointArr.push(800);
            }
        }

        // Actualizar tarjetas KPI con los valores finales
        actualizarKPIs(
            co2Arr[co2Arr.length - 1],
            pwmArr[pwmArr.length - 1]
        );

        // Renderizar / actualizar los gráficos
        dibujarGraficos(tiempoArr, co2Arr, pwmArr, setpointArr);

    } catch (e) {
        console.error(e);
        alert('Error en la simulación: ' + e.message);
    }
};

/* ============================================================
   ACTUALIZAR KPIs
   ============================================================ */
function actualizarKPIs(co2Final, pwmFinal) {
    const kpiCO2 = document.getElementById('kpi-co2');
    const kpiPWM = document.getElementById('kpi-pwm');

    if (kpiCO2) {
        kpiCO2.innerText = Math.round(co2Final) + ' ppm';
        kpiCO2.className = 'kpi-value ' + (co2Final > 1000 ? 'kpi-red' : co2Final > 850 ? 'kpi-red' : 'kpi-green');
    }
    if (kpiPWM) {
        kpiPWM.innerText = Math.round(pwmFinal);
    }
}

/* ============================================================
   DIBUJAR GRÁFICOS
   Destruye instancias previas y recrea los dos Chart.js.
   Incluye zoom con rueda del mouse y doble clic para restablecer.
   ============================================================ */
function dibujarGraficos(tiempo, co2, pwm, setpoint) {
    if (chartCO2) { chartCO2.destroy(); chartCO2 = null; }
    if (chartPWM) { chartPWM.destroy(); chartPWM = null; }

    // Función para formatear los minutos decimales (ej: 25.5 -> "25m 30s")
    const formatTime = (minsFloat) => {
        const totalSecs = Math.round(minsFloat * 60);
        const h = Math.floor(totalSecs / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        const s = totalSecs % 60;
        let str = '';
        if (h > 0) str += `${h}h `;
        if (m > 0 || h > 0) str += `${m}m `;
        str += `${s}s`;
        return str.trim();
    };

    const labels = tiempo.map(t => formatTime(t));

    // Opciones de zoom compartidas (rueda del mouse)
    const zoomOptions = {
        zoom: {
            wheel:  { enabled: true, speed: 0.08 },
            pinch:  { enabled: true },
            mode:   'x',
        },
        pan: {
            enabled: true,
            mode:    'x',
        },
        limits: {
            x: { min: 'original', max: 'original' },
        }
    };

    // Opciones de escala compartidas
    const scaleXBase = {
        title: { display: true, text: 'Tiempo (min)', font: { size: 12 } },
        min: 0,
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: {
            maxTicksLimit: 13,   // ~cada 15 min
            callback: function(val, index) {
                // Devolver el label correspondiente solo en los ticks seleccionados por maxTicksLimit
                return this.getLabelForValue(val);
            }
        }
    };

    // ── Gráfico 1: Concentración de CO₂ ──────────────────────
    const ctxCO2 = document.getElementById('chartCO2').getContext('2d');
    chartCO2 = new Chart(ctxCO2, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'CO₂ Real (ppm)',
                    data: co2,
                    borderColor: '#ef4444',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    tension: 0.15,
                    fill: false
                },
                {
                    label: 'Setpoint – 800 ppm',
                    data: setpoint,
                    borderColor: '#22c55e',
                    borderDash: [6, 5],
                    borderWidth: 1.8,
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400, easing: 'easeOutQuart' },
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                annotation: {
                    annotations: {
                        sla: {
                            type: 'line',
                            yMin: 1000,
                            yMax: 1000,
                            borderColor: '#f59e0b',
                            borderWidth: 1.5,
                            borderDash: [4, 4],
                            label: {
                                display: true,
                                content: '⚠ SLA: 1000 ppm',
                                position: 'start',
                                backgroundColor: 'rgba(245,158,11,0.85)',
                                color: '#fff',
                                font: { size: 11, weight: '600' },
                                padding: { x: 8, y: 4 },
                                borderRadius: 4
                            }
                        }
                    }
                },
                legend: {
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'line',
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(10,16,32,0.92)',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} ppm`
                    }
                },
                zoom: zoomOptions
            },
            scales: {
                y: {
                    min: 350,
                    max: 1500,
                    title: { display: true, text: 'CO₂ (ppm)', font: { size: 12 } },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: scaleXBase
            }
        }
    });

    // Doble clic para restablecer zoom en el gráfico CO2
    document.getElementById('chartCO2').addEventListener('dblclick', () => {
        chartCO2.resetZoom();
    });

    // ── Gráfico 2: Señal PWM ──────────────────────────────────
    const ctxPWM = document.getElementById('chartPWM').getContext('2d');
    chartPWM = new Chart(ctxPWM, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Señal PWM (0 – 255)',
                    data: pwm,
                    borderColor: '#3b82f6',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: true,
                    backgroundColor: 'rgba(59,130,246,0.10)',
                    tension: 0.15
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400, easing: 'easeOutQuart' },
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: {
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'line',
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(10,16,32,0.92)',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}`
                    }
                },
                zoom: zoomOptions
            },
            scales: {
                y: {
                    min: 0,
                    max: 275,
                    title: { display: true, text: 'PWM (0–255)', font: { size: 12 } },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: scaleXBase
            }
        }
    });

    // Doble clic para restablecer zoom en el gráfico PWM
    document.getElementById('chartPWM').addEventListener('dblclick', () => {
        chartPWM.resetZoom();
    });
}

// ── Arrancar cuando el DOM esté listo ─────────────────────────
document.addEventListener('DOMContentLoaded', init);