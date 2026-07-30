# Probar Bytewall en una computadora con Windows

Guía para tener el programa funcionando en tu propia máquina, sin saber
programar. Son cuatro pasos y toma unos 10 minutos. Nada de esto afecta a nadie
más: todo queda en tu computadora.

Al terminar vas a abrir el navegador en `http://localhost:3000` y entrar con tu
usuario.

---

## Paso 1. Instalar Node.js

Node.js es el motor que hace funcionar el programa. Se instala una sola vez.

1. Entra a **<https://nodejs.org/en/download>**.
2. Descarga la versión **LTS** para **Windows** (el archivo `.msi`).
   Necesitas la **versión 22 o más nueva**; la LTS que ofrece la página ya lo es.
3. Abre el archivo descargado y dale **Next / Siguiente** en todas las
   pantallas, sin cambiar nada. Al final, **Finish**.

Para comprobar que quedó bien instalado:

1. Presiona la tecla **Windows**, escribe `powershell` y abre
   **Windows PowerShell**.
2. Escribe esto y presiona Enter:

   ```powershell
   node --version
   ```

3. Debe responder algo como `v22.11.0` o mayor. Si dice que no reconoce el
   comando, cierra PowerShell, ábrelo de nuevo y vuelve a probar.

## Paso 2. Descargar el programa

1. Descarga el archivo comprimido desde este enlace:
   **<https://github.com/edgarponce08/bytewall/archive/refs/heads/claude/project-control-interface-p8obuo.zip>**
2. Ve a tu carpeta de **Descargas**, da clic derecho en el archivo y elige
   **Extraer todo… → Extraer**.
3. Te queda una carpeta con un nombre largo, algo como
   `bytewall-claude-project-control-interface-p8obuo`. Para que sea más cómodo:
   **cámbiale el nombre a `bytewall`** y **muévela a `C:\bytewall`**.

Al final debes tener la carpeta `C:\bytewall` y, dentro de ella, archivos como
`server.js`, `package.json` y una carpeta `public`.

## Paso 3. Instalar y arrancar

1. Abre **PowerShell** (tecla Windows → escribe `powershell` → Enter).
2. Escribe este comando y presiona Enter para entrar a la carpeta:

   ```powershell
   cd C:\bytewall
   ```

3. Instala lo que el programa necesita (esto tarda 1 o 2 minutos y solo se hace
   una vez):

   ```powershell
   npm install
   ```

4. Arranca el programa:

   ```powershell
   npm start
   ```

5. En la pantalla va a aparecer algo así:

   ```
   === Usuario administrador inicial ===
     Correo:     admin@bytewall.local
     Contrasena: 6-_KmPSnhaqt
     Cambiela despues de iniciar sesion.

   Bytewall escuchando en http://localhost:3000
   ```

   **Copia esa contraseña y guárdala**: solo se muestra esta vez. Para
   copiarla, selecciónala con el mouse y presiona Enter (así se copia en
   PowerShell).

**Deja esa ventana de PowerShell abierta.** Mientras esté abierta, el programa
está encendido. Si la cierras, se apaga.

## Paso 4. Entrar

1. Abre tu navegador (Chrome, Edge, el que uses).
2. Ve a **<http://localhost:3000>**.
3. Escribe el correo `admin@bytewall.local` y la contraseña que copiaste.
4. Ya dentro, lo primero: haz clic en el botón **Contraseña**, arriba a la
   derecha, y cámbiala por una que recuerdes.

Listo. Ahora puedes usarlo:

- **+ Persona** — da de alta a cada integrante del equipo, con su correo y una
  contraseña inicial. Esa contraseña es la que le vas a pasar para que entre.
- **+ Nuevo proyecto** — nombre, descripción, responsable, estado y avance.
- Haz clic en cualquier tarjeta para abrir el proyecto, subir evidencias y
  cambiar el avance.
- Arrastra las tarjetas entre columnas para cambiar el estado.

---

## Encender y apagar de aquí en adelante

**Para encenderlo** (cada vez que reinicies la computadora):

```powershell
cd C:\bytewall
npm start
```

**Para apagarlo**: en la ventana de PowerShell presiona **Ctrl + C**, o
simplemente ciérrala.

No pierdes nada al apagarlo: los proyectos y las evidencias quedan guardados en
la carpeta `C:\bytewall\data`.

## Ver datos de ejemplo (opcional)

Si quieres ver la pantalla llena para entender cómo se va a ver en uso, con el
programa **apagado** escribe:

```powershell
cd C:\bytewall
npm run seed
```

Carga 3 personas y 4 proyectos de ejemplo, y te dice con qué correos entrar
(la contraseña de todos es `bytewall2026`). Luego arranca con `npm start`.
Son datos de prueba: bórralos antes de usarlo en serio.

## Si algo sale mal

| Lo que ves | Qué hacer |
|---|---|
| `npm : El término 'npm' no se reconoce…` | Node.js no quedó instalado o falta reiniciar. Cierra PowerShell, ábrelo otra vez y prueba `node --version`. Si sigue igual, reinstala Node.js. |
| `No se puede encontrar la ruta 'C:\bytewall'` | La carpeta no está ahí o tiene otro nombre. Abre el Explorador, ubica la carpeta y confirma que se llama exactamente `bytewall` y está en `C:\`. |
| `Unsupported engine` o `EBADENGINE` | Tu Node.js es más viejo que la versión 22. Instala la LTS desde nodejs.org. |
| `EADDRINUSE` | El programa ya está encendido en otra ventana. Búscala y úsala, o cierra esa ventana y vuelve a arrancar. |
| Perdiste la contraseña del administrador | Apaga el programa y escribe: `npm run user -- passwd admin@bytewall.local`. Te da una contraseña nueva en pantalla. |
| El navegador dice que no puede conectar | Revisa que la ventana de PowerShell siga abierta con el mensaje «Bytewall escuchando…». |
| Windows pregunta por el Firewall | Si solo lo vas a usar en tu computadora, puedes **cancelar**. Si quieres que otros entren, permite el acceso en **redes privadas**. |

## Cuando quieras que lo use el equipo

Lo de arriba sirve para probarlo tú. Para que tus compañeros lo usen todos los
días conviene instalarlo en una computadora que quede siempre encendida, con
HTTPS y respaldos automáticos. Eso está en la
**[guía de operación interna](OPERACION.md)**, escrita para quien administre el
equipo o el servidor.

Un aviso importante: mientras corra así, sin HTTPS, **úsalo solo en tu propia
computadora**. Si lo abres a la red de la oficina sin HTTPS, las contraseñas y
las sesiones viajan sin protección.
