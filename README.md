# Trabajo Final Integrador: Control de Calidad de Aire (CO2)

**Alumnos:** [COMPLETAR NOMBRE]  
**Materia:** Tecnologías para la Automatización (UTN FRBA)  
**Profesor:** Omar Oscar Civale

## Descripción de la Simulación

Este repositorio contiene el **Tablero de Control Interactivo** diseñado para el Trabajo Práctico Integrador. La simulación modela un sistema SISO (Single-Input Single-Output) a lazo cerrado, encargado de regular la concentración de CO2 en un aula universitaria mediante ventilación por demanda, utilizando un controlador PI.

La lógica matemática de la simulación resuelve las ecuaciones diferenciales de las transferencias de la Planta, Actuador y Controlador mediante el **método de discretización temporal de Euler**, simulando el comportamiento real de un microcontrolador (ej. Arduino).

## Cómo ejecutar la simulación

El sistema está desarrollado integramente en HTML y JavaScript (Vanilla) de ejecución del lado del cliente, por lo que **no requiere instalación de software, paquetes ni servidores locales.**

### Opción 1: Ejecución Online (Recomendada)

Haga clic en el siguiente enlace para abrir la simulación directamente en su navegador a través de GitHub Pages:
**[Pegar aquí el link de GitHub Pages]**

### Opción 2: Ejecución Local

1. Haga clic en el botón verde **"Code"** en este repositorio y seleccione **"Download ZIP"**.
2. Descomprima el archivo en su computadora.
3. Haga doble clic en el archivo `index.html`. Se abrirá automáticamente en su navegador web predeterminado.

## Instrucciones de uso del Tablero

Desde el panel de control (lado izquierdo), se podrá interactuar con las variables del sistema en tiempo real. **La simulación se recalcula automáticamente** cada vez que se suelta un control (no requiere presionar ningún botón de ejecución). Se podrá observar el impacto inmediatamente en la respuesta dinámica de los gráficos (Estado transitorio y estable):

### 1. Sintonización (PI)

- **Proporcional ($K_p$):** Reacciona al error actual. Valores más altos hacen que el sistema responda más rápido (el extractor acelera más bruscamente ante una subida de CO₂), pero si es excesivo puede causar oscilaciones.
- **Integral ($K_i$):** Reacciona al error acumulado en el tiempo. Es el encargado de eliminar el error en estado estable para que el CO₂ llegue exactamente a 800 ppm, pero si es muy alto generará un gran sobreimpulso (overshoot).

### 2. Hardware

- **Caudal Máximo Extractor ($Q_{MAX}$):** Define la potencia física del extractor en m³/h. Si se reduce demasiado frente a un aula llena, el extractor funcionará al 100% de su capacidad (PWM = 255) pero no logrará bajar el CO₂ a 800 ppm (Saturación).

### 3. Ocupación del Aula

- **Cantidad de Alumnos:** Modifica la carga (perturbación constante). Determina la tasa de inyección de CO₂. Si la reduce a 0, el sistema apagará el extractor paulatinamente hasta llegar a 0 PWM, dejando el aula en el nivel de CO₂ exterior (400 ppm).

### 4. Perturbación Ambiental

- **Abrir Puerta del Aula:** Introduce una perturbación negativa en el sistema (caída de CO₂). Simula una ventilación natural no controlada. Al activarla, se verá cómo el CO₂ baja repentinamente y el controlador reduce el esfuerzo del ventilador para compensarlo.

### 5. Navegación en los Gráficos

- **Zoom y Paneo:** Puede utilizar la **rueda del mouse** sobre los gráficos para hacer zoom en el eje del tiempo y arrastrar para moverse a lo largo de las 3 horas de simulación (correspondiente a una clase promedio). Haga **doble clic** sobre cualquier gráfico para restablecer la vista.
