import dotenv from "dotenv";
// Cargamos las variables de entorno antes de importar cualquier otro módulo.
// Si dotenv.config() se llamara después, supabase.ts leería process.env vacío y lanzaría error.
dotenv.config();

import express from "express";
import authRoutes from "./auth/auth.routes";

// Creamos la instancia principal de la aplicación Express
const app = express();

// Permitimos que el servidor entienda JSON en el cuerpo de las peticiones
app.use(express.json());

// Puerto donde escucha el servidor — lo leeremos de las variables de entorno en producción
const PORT = process.env.PORT || 3000;

// Ruta de prueba para verificar que el servidor está funcionando
app.get("/", (req, res) => {
  res.json({ message: "ConCompas API funcionando" });
});

// Registramos las rutas de autenticación bajo el prefijo /auth.
// Todos los endpoints quedan disponibles en /auth/registro, /auth/login, etc.
app.use("/auth", authRoutes);

// Arrancamos el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
