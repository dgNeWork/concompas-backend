import { Request } from "express";

// Roles disponibles en el sistema — refleja el ENUM rol_usuario de la base de datos.
// Definirlo aquí como tipo TypeScript nos permite usarlo en todo el backend con seguridad
// de tipos: si escribimos un rol que no existe, TypeScript lo detecta en compilación.
export type RolUsuario = "cliente" | "taxista" | "admin";

// Datos del usuario autenticado que el middleware adjunta a cada request protegida.
// Es lo mínimo necesario para identificar al usuario y tomar decisiones de autorización.
export interface UsuarioAutenticado {
  id: string;
  email: string;
  rol: RolUsuario;
  nombre: string;
  apellidos: string;
}

// Extensión del tipo Request de Express para incluir el usuario autenticado.
// En las rutas protegidas, el middleware rellena req.usuario antes de llegar
// al controlador, así que podemos acceder a él con tipado correcto sin castings.
export interface RequestAutenticada extends Request {
  usuario: UsuarioAutenticado;
}

// DTO (Data Transfer Object) para el registro de un nuevo usuario.
// Un DTO define exactamente qué datos esperamos recibir del cliente para una operación.
// Separa la forma del dato entrante de la lógica de negocio interna.
export interface RegistroDto {
  email: string;
  password: string;
  nombre: string;
  apellidos: string;
  documento_identidad: string;
  telefono: string;
  rol: "cliente" | "taxista";
  // Campo opcional exclusivo de clientes
  direccion_habitual?: string;
  // Campo opcional exclusivo de taxistas
  es_titular?: boolean;
}

// DTO para el inicio de sesión
export interface LoginDto {
  email: string;
  password: string;
}
