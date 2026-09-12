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
// NOTA (Ticket 15): usada por los módulos que aún no se han migrado a NestJS
// (maps, trayectos, stripe, cancelaciones) junto con el middleware autenticar().
// Se retira cuando el último de esos módulos pase a Nest, donde el usuario
// autenticado se obtiene con el decorador @Usuario() en vez de este cast.
export interface RequestAutenticada extends Request {
  usuario: UsuarioAutenticado;
}

// Los DTOs de registro y login viven ahora junto a sus schemas de Zod en
// ./dto/registro.dto.ts y ./dto/login.dto.ts.
