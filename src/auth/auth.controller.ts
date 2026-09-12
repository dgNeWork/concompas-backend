import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { Usuario } from "./decorators/usuario.decorator";
import { UsuarioAutenticado } from "./auth.types";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { registroSchema, RegistroDto } from "./dto/registro.dto";
import { loginSchema, LoginDto } from "./dto/login.dto";

// AuthController gestiona el ciclo request → respuesta de cada endpoint.
// Responsabilidad única: recibir la petición, validar el body (delegado al
// pipe) y llamar al servicio. No contiene lógica de negocio.
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /auth/registro — pública
  @Post("registro")
  @HttpCode(HttpStatus.CREATED)
  async registro(
    @Body(new ZodValidationPipe(registroSchema, "Datos de registro inválidos")) dto: RegistroDto,
  ) {
    try {
      const usuario = await this.authService.registrar(dto);
      return { mensaje: "Usuario registrado correctamente", usuario };
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error inesperado al registrar";
      throw new BadRequestException(mensaje);
    }
  }

  // POST /auth/login — pública
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body(new ZodValidationPipe(loginSchema, "Datos de login inválidos")) dto: LoginDto) {
    try {
      return await this.authService.login(dto);
    } catch {
      // Devolvemos siempre el mismo mensaje genérico, sin distinguir entre
      // "usuario no existe" y "contraseña incorrecta". Dar esa información
      // permitiría a un atacante saber qué emails están registrados (enumeración).
      throw new UnauthorizedException("Credenciales incorrectas");
    }
  }

  // POST /auth/logout — protegida
  @Post("logout")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request) {
    // AuthGuard ya ha verificado el token, así que sabemos que la cabecera existe.
    const token = req.headers.authorization!.split(" ")[1];

    try {
      await this.authService.logout(token);
      return { mensaje: "Sesión cerrada correctamente" };
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al cerrar sesión";
      throw new InternalServerErrorException(mensaje);
    }
  }

  // GET /auth/me — protegida
  // AuthGuard ya ha verificado el token y cargado el perfil, así que solo lo
  // devolvemos sin necesidad de ir a la base de datos de nuevo.
  @Get("me")
  @UseGuards(AuthGuard)
  me(@Usuario() usuario: UsuarioAutenticado) {
    return { usuario };
  }
}
