// =============================================================================
// CANCELACIONES CONTROLLER
// =============================================================================
// Responsabilidad única: recibir la request HTTP, validar los datos (delegado
// al pipe) y llamar a CancelacionesService. No contiene lógica de negocio.
//
// La cancelación de un trayecto en sí (PATCH /trayectos/:id/estado) sigue
// viviendo en trayectos.controller.ts — este módulo solo gestiona lo que pasa
// DESPUÉS de generarse una penalización: justificarla y resolverla.
// =============================================================================

import {
  ForbiddenException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { CancelacionesService } from "./cancelaciones.service";
import { AuthGuard } from "../auth/auth.guard";
import { Usuario } from "../auth/decorators/usuario.decorator";
import { UsuarioAutenticado } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { justificarSchema, JustificarInput, resolverSchema, ResolverInput } from "./dto/cancelaciones.dto";

@Controller("cancelaciones")
@UseGuards(AuthGuard)
export class CancelacionesController {
  constructor(private readonly cancelacionesService: CancelacionesService) {}

  // GET /cancelaciones/mis-penalizaciones
  // El taxista ve sus propias penalizaciones (para encontrar el ID que necesita
  // al justificar, y para conocer su situación económica).
  @Get("mis-penalizaciones")
  async listarPropias(@Usuario() usuario: UsuarioAutenticado) {
    if (usuario.rol !== "taxista") {
      throw new ForbiddenException("Solo los taxistas tienen penalizaciones");
    }

    try {
      return await this.cancelacionesService.listarPenalizacionesTaxista(usuario.id);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al listar penalizaciones";
      throw new InternalServerErrorException(mensaje);
    }
  }

  // PATCH /cancelaciones/:id/justificar
  // El taxista penalizado añade un texto explicativo para que el admin lo revise.
  @Patch(":id/justificar")
  async justificar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(justificarSchema)) dto: JustificarInput,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    if (usuario.rol !== "taxista") {
      throw new ForbiddenException("Solo los taxistas pueden justificar penalizaciones");
    }

    try {
      return await this.cancelacionesService.justificarPenalizacion(id, usuario.id, dto);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al justificar la penalización";
      const status = mensaje.includes("permiso")
        ? HttpStatus.FORBIDDEN
        : mensaje.includes("encontrada")
        ? HttpStatus.NOT_FOUND
        : mensaje.includes("pendiente")
        ? HttpStatus.BAD_REQUEST
        : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException({ error: mensaje }, status);
    }
  }

  // PATCH /cancelaciones/:id/resolver
  // El admin resuelve una penalización pendiente: la deja descontada o la anula
  // por justificación válida.
  @Patch(":id/resolver")
  async resolver(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resolverSchema)) dto: ResolverInput,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    if (usuario.rol !== "admin") {
      throw new ForbiddenException("Solo el admin puede resolver penalizaciones");
    }

    try {
      return await this.cancelacionesService.resolverPenalizacion(id, dto);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al resolver la penalización";
      const status = mensaje.includes("encontrada")
        ? HttpStatus.NOT_FOUND
        : mensaje.includes("resuelta")
        ? HttpStatus.BAD_REQUEST
        : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException({ error: mensaje }, status);
    }
  }
}
