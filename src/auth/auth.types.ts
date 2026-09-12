// Roles disponibles en el sistema — refleja el ENUM rol_usuario de la base de datos.
// Definirlo aquí como tipo TypeScript nos permite usarlo en todo el backend con seguridad
// de tipos: si escribimos un rol que no existe, TypeScript lo detecta en compilación.
export type RolUsuario = "cliente" | "taxista" | "admin";

// Datos del usuario autenticado que AuthGuard adjunta a cada request protegida.
// Es lo mínimo necesario para identificar al usuario y tomar decisiones de autorización.
// El controlador lo obtiene con el decorador @Usuario() (ver ./decorators/usuario.decorator.ts).
export interface UsuarioAutenticado {
  id: string;
  email: string;
  rol: RolUsuario;
  nombre: string;
  apellidos: string;
}

// Los DTOs de registro y login viven junto a sus schemas de Zod en
// ./dto/registro.dto.ts y ./dto/login.dto.ts.
