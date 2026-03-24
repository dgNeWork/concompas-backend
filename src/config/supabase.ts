import { createClient } from "@supabase/supabase-js";

// Leemos las credenciales desde las variables de entorno.
// Nunca hardcodeamos estas claves en el código — están en .env y nunca se suben a GitHub.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Si faltan las credenciales, detenemos el servidor antes de que arranque.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan las variables de entorno SUPABASE_URL o SUPABASE_ANON_KEY",
  );
}

if (!supabaseServiceRoleKey) {
  throw new Error(
    "Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY",
  );
}

// Cliente estándar — usa la anon key y respeta el RLS definido en las migraciones.
// Se usa para operaciones que actúan en nombre del usuario autenticado (ej: login).
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cliente de administración — usa la service role key, que bypasea el RLS.
// IMPORTANTE: solo usar en el servidor, jamás exponerlo al cliente.
// Se usa para operaciones privilegiadas: registro de usuarios, verificación de tokens,
// operaciones de admin que necesitan acceso sin restricciones de RLS.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false, // el servidor no necesita refrescar tokens automáticamente
    persistSession: false,   // cada petición es independiente, no hay sesión persistente
  },
});
