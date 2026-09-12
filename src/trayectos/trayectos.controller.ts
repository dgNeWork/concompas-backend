// =============================================================================
// TRAYECTOS CONTROLLER
// =============================================================================
// Responsabilidad única: recibir la request HTTP, validar los datos (delegado
// al pipe) y llamar a TrayectosService. No contiene lógica de negocio.
// =============================================================================

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TrayectosService } from "./trayectos.service";
import { AuthGuard } from "../auth/auth.guard";
import { Usuario } from "../auth/decorators/usuario.decorator";
import { UsuarioAutenticado } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  crearTrayectoSchema,
  CrearTrayectoInput,
  aceptarTrayectoSchema,
  AceptarTrayectoInput,
  cambiarEstadoSchema,
  CambiarEstadoInput,
} from "./dto/trayectos.dto";

// Todas las rutas requieren JWT válido — no hay endpoints públicos en este módulo.
// La autorización fina (qué rol puede hacer qué) se gestiona en el servicio y el controlador.
@Controller("trayectos")
@UseGuards(AuthGuard)
export class TrayectosController {
  constructor(private readonly trayectosService: TrayectosService) {}

  // POST /trayectos — crea una nueva reserva (solo clientes)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body(new ZodValidationPipe(crearTrayectoSchema)) dto: CrearTrayectoInput,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    // Comprobamos que quien crea el trayecto es un cliente (doble seguro además del guard de ruta)
    if (usuario.rol !== "cliente") {
      throw new ForbiddenException("Solo los clientes pueden crear reservas");
    }

    try {
      return await this.trayectosService.crearTrayecto(usuario.id, dto);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al crear el trayecto";
      throw new InternalServerErrorException(mensaje);
    }
  }

  // GET /trayectos — lista trayectos según el rol:
  //   - cliente: sus propias reservas
  //   - taxista: reservas disponibles en su municipio
  //   - admin: todas las reservas
  @Get()
  async listar(@Usuario() usuario: UsuarioAutenticado) {
    try {
      return await this.trayectosService.listarTrayectos(usuario.id, usuario.rol);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al listar trayectos";
      throw new InternalServerErrorException(mensaje);
    }
  }

  // GET /trayectos/:id — detalle de un trayecto. Verifica que el usuario tiene acceso.
  @Get(":id")
  async obtener(@Param("id") id: string, @Usuario() usuario: UsuarioAutenticado) {
    try {
      return await this.trayectosService.obtenerTrayecto(id, usuario.id, usuario.rol);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al obtener el trayecto";
      const status = mensaje.includes("permiso")
        ? HttpStatus.FORBIDDEN
        : mensaje.includes("encontrado")
        ? HttpStatus.NOT_FOUND
        : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException({ error: mensaje }, status);
    }
  }

  // POST /trayectos/:id/aceptar — el taxista acepta la reserva (titular o suplente)
  @Post(":id/aceptar")
  async aceptar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(aceptarTrayectoSchema)) dto: AceptarTrayectoInput,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    if (usuario.rol !== "taxista") {
      throw new ForbiddenException("Solo los taxistas pueden aceptar reservas");
    }

    try {
      return await this.trayectosService.aceptarTrayecto(id, usuario.id, dto);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al aceptar el trayecto";
      const status =
        mensaje.includes("permiso") || mensaje.includes("municipio") || mensaje.includes("completo")
          ? HttpStatus.FORBIDDEN
          : mensaje.includes("encontrado")
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException({ error: mensaje }, status);
    }
  }

  // PATCH /trayectos/:id/estado — cambia el estado del trayecto. Las transiciones
  // válidas dependen del rol (ver TrayectosService.verificarPermisoEstado).
  @Patch(":id/estado")
  async cambiarEstado(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cambiarEstadoSchema)) dto: CambiarEstadoInput,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    try {
      return await this.trayectosService.cambiarEstado(id, usuario.id, usuario.rol, dto);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al cambiar el estado";
      const status =
        mensaje.includes("permiso") || mensaje.includes("Solo el taxista")
          ? HttpStatus.FORBIDDEN
          : mensaje.includes("encontrado")
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST;
      throw new HttpException({ error: mensaje }, status);
    }
  }
}
