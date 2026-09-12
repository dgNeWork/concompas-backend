import { Injectable } from "@nestjs/common";
import { SupabaseService } from "../config/supabase.service";
import { RegistroDto } from "./dto/registro.dto";
import { LoginDto } from "./dto/login.dto";
import { UsuarioAutenticado } from "./auth.types";

// AuthService encapsula toda la lógica de autenticación.
// Los controladores no conocen los detalles de Supabase — solo llaman a este servicio.
// Principio SRP: este servicio tiene una única responsabilidad, gestionar la autenticación.
// Principio DIP: depende de la abstracción SupabaseService (inyectada), no de Supabase directamente.
@Injectable()
export class AuthService {
  constructor(private readonly supabaseService: SupabaseService) {}

  // Registra un nuevo usuario en tres pasos:
  //   1. Crea el usuario en Supabase Auth (auth.users)
  //   2. Crea su perfil base en nuestra tabla profiles
  //   3. Crea su perfil específico según el rol (clientes_perfil o taxistas_perfil)
  //
  // Usamos supabaseAdmin en los pasos 2 y 3 porque el usuario recién creado aún no
  // tiene sesión activa, y el RLS bloquearía los INSERT si usáramos el cliente estándar.
  async registrar(dto: RegistroDto): Promise<UsuarioAutenticado> {
    const admin = this.supabaseService.admin;

    // Paso 1: crear el usuario en Supabase Auth
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
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
    const { error: profileError } = await admin
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
      await admin.auth.admin.deleteUser(userId);
      throw new Error(`Error al crear el perfil: ${profileError.message}`);
    }

    // Paso 3: crear el perfil específico del rol
    if (dto.rol === "cliente") {
      const { error: clienteError } = await admin
        .from("clientes_perfil")
        .insert({
          profile_id: userId,
          direccion_habitual: dto.direccion_habitual ?? null,
        });

      if (clienteError) {
        await admin.auth.admin.deleteUser(userId);
        throw new Error(`Error al crear el perfil de cliente: ${clienteError.message}`);
      }
    }

    if (dto.rol === "taxista") {
      const { error: taxistaError } = await admin
        .from("taxistas_perfil")
        .insert({
          profile_id: userId,
          es_titular: dto.es_titular ?? false,
        });

      if (taxistaError) {
        await admin.auth.admin.deleteUser(userId);
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
  // Devuelve los tokens JWT que el cliente guardará y usará en futuras peticiones.
  async login(dto: LoginDto) {
    const { client, admin } = this.supabaseService;

    const { data, error } = await client.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.session) {
      throw new Error(error?.message || "Credenciales incorrectas");
    }

    // Leemos el perfil para incluir el rol y nombre en la respuesta,
    // de forma que la app no tenga que hacer una segunda petición para obtenerlos.
    const { data: profile, error: profileError } = await admin
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

  // Cierra la sesión del usuario invalidando el token en Supabase.
  // supabaseAdmin.auth.admin.signOut espera el JWT del usuario, no su UUID.
  // Al invalidarlo en el servidor, el token queda inutilizable aunque el cliente
  // aún lo tenga guardado localmente.
  async logout(token: string): Promise<void> {
    const { error } = await this.supabaseService.admin.auth.admin.signOut(token);
    if (error) {
      throw new Error(`Error al cerrar la sesión: ${error.message}`);
    }
  }

  // Verifica un token JWT y devuelve los datos del usuario autenticado.
  // La usa AuthGuard para proteger rutas: si el token no es válido, lanza un
  // error y el guard responde con 401 antes de llegar al controlador.
  async verificarToken(token: string): Promise<UsuarioAutenticado> {
    const admin = this.supabaseService.admin;
    const { data, error } = await admin.auth.getUser(token);

    if (error || !data.user) {
      throw new Error("Token inválido o expirado");
    }

    const { data: profile, error: profileError } = await admin
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
