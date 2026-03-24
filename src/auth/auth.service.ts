import { supabase, supabaseAdmin } from "../config/supabase";
import { RegistroDto, LoginDto, UsuarioAutenticado } from "./auth.types";

// AuthService encapsula toda la lógica de autenticación.
// Los controladores no conocen los detalles de Supabase — solo llaman a este servicio.
// Principio SRP: este servicio tiene una única responsabilidad, gestionar la autenticación.
// Principio DIP: el controlador depende de esta abstracción, no de Supabase directamente.

export class AuthService {

  // Registra un nuevo usuario en tres pasos:
  //   1. Crea el usuario en Supabase Auth (auth.users)
  //   2. Crea su perfil base en nuestra tabla profiles
  //   3. Crea su perfil específico según el rol (clientes_perfil o taxistas_perfil)
  //
  // Usamos supabaseAdmin en los pasos 2 y 3 porque el usuario recién creado aún no
  // tiene sesión activa, y el RLS bloquearía los INSERT si usáramos el cliente estándar.
  async registrar(dto: RegistroDto): Promise<UsuarioAutenticado> {

    // Paso 1: crear el usuario en Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      // Confirmamos el email automáticamente para no complicar el flujo del MVP.
      // En fases posteriores se puede activar la verificación por email.
      email_confirm: true,
    });

    if (authError || !authData.user) {
      throw new Error(authError?.message || "Error al crear el usuario en el sistema de autenticación");
    }

    const userId = authData.user.id;

    // Paso 2: crear el perfil base en nuestra tabla profiles
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({
        id: userId,
        rol: dto.rol,
        nombre: dto.nombre,
        apellidos: dto.apellidos,
        documento_identidad: dto.documento_identidad,
        telefono: dto.telefono,
      });

    if (profileError) {
      // Si falla la inserción del perfil, eliminamos el usuario de auth para no
      // dejar datos huérfanos (usuario en auth.users sin perfil en profiles).
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(`Error al crear el perfil: ${profileError.message}`);
    }

    // Paso 3: crear el perfil específico del rol
    if (dto.rol === "cliente") {
      const { error: clienteError } = await supabaseAdmin
        .from("clientes_perfil")
        .insert({
          profile_id: userId,
          direccion_habitual: dto.direccion_habitual ?? null,
        });

      if (clienteError) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        throw new Error(`Error al crear el perfil de cliente: ${clienteError.message}`);
      }
    }

    if (dto.rol === "taxista") {
      const { error: taxistaError } = await supabaseAdmin
        .from("taxistas_perfil")
        .insert({
          profile_id: userId,
          es_titular: dto.es_titular ?? false,
        });

      if (taxistaError) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        throw new Error(`Error al crear el perfil de taxista: ${taxistaError.message}`);
      }
    }

    return {
      id: userId,
      email: dto.email,
      rol: dto.rol,
      nombre: dto.nombre,
      apellidos: dto.apellidos,
    };
  }

  // Inicia sesión con email y contraseña.
  // Devuelve los tokens JWT que el cliente móvil guardará y usará en futuras peticiones.
  async login(dto: LoginDto) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.session) {
      throw new Error(error?.message || "Credenciales incorrectas");
    }

    // Leemos el perfil para incluir el rol y nombre en la respuesta,
    // de forma que la app no tenga que hacer una segunda petición para obtenerlos.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("rol, nombre, apellidos")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile) {
      throw new Error("Error al obtener el perfil del usuario");
    }

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      user: {
        id: data.user.id,
        email: data.user.email,
        rol: profile.rol,
        nombre: profile.nombre,
        apellidos: profile.apellidos,
      },
    };
  }

  // Cierra la sesión del usuario invalidando todos sus tokens activos en Supabase.
  // Al usar signOut con el cliente admin, la sesión queda invalidada en el servidor
  // aunque el cliente móvil aún tenga el token guardado localmente.
  async logout(userId: string): Promise<void> {
    const { error } = await supabaseAdmin.auth.admin.signOut(userId);
    if (error) {
      throw new Error(`Error al cerrar la sesión: ${error.message}`);
    }
  }

  // Verifica un token JWT y devuelve los datos del usuario autenticado.
  // Es el método que usa el middleware para proteger rutas: si el token no es válido,
  // lanza un error y el middleware responde con 401 antes de llegar al controlador.
  async verificarToken(token: string): Promise<UsuarioAutenticado> {
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      throw new Error("Token inválido o expirado");
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("rol, nombre, apellidos")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile) {
      throw new Error("Perfil de usuario no encontrado");
    }

    return {
      id: data.user.id,
      email: data.user.email!,
      rol: profile.rol,
      nombre: profile.nombre,
      apellidos: profile.apellidos,
    };
  }
}

// Exportamos una única instancia del servicio (patrón Singleton).
// El servicio no tiene estado mutable, así que reutilizar la misma instancia
// en toda la aplicación es seguro y eficiente.
export const authService = new AuthService();
