import express from 'express';
import dotenv from 'dotenv';

// Cargamos las variables de entorno desde el archivo .env
dotenv.config();

// Creamos la instancia principal de la aplicación Express
const app = express();

// Permitimos que el servidor entienda JSON en el cuerpo de las peticiones
app.use(express.json());

// Puerto donde escucha el servidor — lo leeremos de las variables de entorno en producción
const PORT = process.env.PORT || 3000;

// Ruta de prueba para verificar que el servidor está funcionando
app.get('/', (req, res) => {
  res.json({ message: 'ConCompas API funcionando' });
});

// Arrancamos el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
