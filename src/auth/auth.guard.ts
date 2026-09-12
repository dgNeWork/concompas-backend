import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { AuthService } from "./auth.service";
import { UsuarioAutenticado } from "./auth.types";

// Guard de autenticación: equivalente en Nest al middleware autenticar() de Express.
// Verifica el JWT contra Supabase (vía AuthService) y adjunta el usuario a la
// request para que el controlador lo lea con el decorador @Usuario().
//
// Uso en un controlador: @UseGuards(AuthGuard) sobre la ruta o la clase entera.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { usuario: UsuarioAutenticado }>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("No autorizado: falta el token de autenticación");
    }

    const token = authHeader.split(" ")[1];

    try {
      request.usuario = await this.authService.verificarToken(token);
      return true;
    } catch {
      throw new UnauthorizedException("No autorizado: token inválido o expirado");
    }
  }
}
