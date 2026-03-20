import { createClient } from "@supabase/supabase-js";

// Leemos las credenciales desde las variables de entorno
// Nunca hardcodeamos estas claves en el código — están en .env y nunca se suben a GitHub
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Si faltan las credenciales, detenemos el servidor antes de que arranque
// Es mejor fallar pronto y con un mensaje claro que fallar tarde con un error confuso
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan las variables de entorno SUPABASE_URL o SUPABASE_ANON_KEY",
  );
}

// Creamos y exportamos el cliente de Supabase
// Este objeto es el que usaremos en toda la aplicación para interactuar con la base de datos
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
