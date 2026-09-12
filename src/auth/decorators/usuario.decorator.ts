import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { UsuarioAutenticado } from "../auth.types";

// Extrae el usuario autenticado que AuthGuard adjuntó a la request.
// Evita repetir `req.usuario` (con su cast) en cada controlador protegido.
//
// Uso: async miMetodo(@Usuario() usuario: UsuarioAutenticado) { ... }
export const Usuario = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UsuarioAutenticado => {
    const request = ctx.switchToHttp().getRequest<{ usuario: UsuarioAutenticado }>();
    return request.usuario;
  },
);
