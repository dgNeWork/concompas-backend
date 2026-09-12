import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { Response } from "express";

// Por defecto, Nest devuelve los errores como { statusCode, message, error }.
// El backend en Express siempre devolvía { error: "mensaje" } (y, en validaciones,
// { error: "mensaje", detalles: [...] }). Este filtro normaliza cualquier
// HttpException a ese mismo formato para no romper el contrato de la API que
// ya usan Postman y, más adelante, los frontends.
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const cuerpo = exception.getResponse();

    // ZodValidationPipe ya lanza { error, detalles } con la forma final. Se
    // distingue del resto porque Nest SIEMPRE añade "message" a las suyas
    // (incluso las que traen "error" con el nombre genérico del status HTTP,
    // como "Unauthorized"), y nuestro pipe nunca incluye esa clave.
    if (typeof cuerpo === "object" && cuerpo !== null && !("message" in cuerpo)) {
      response.status(status).json(cuerpo);
      return;
    }

    // El resto de excepciones (BadRequestException("mensaje"), UnauthorizedException...)
    // traen { statusCode, message, error } por defecto — nos quedamos solo con el mensaje.
    const mensaje =
      typeof cuerpo === "string"
        ? cuerpo
        : (cuerpo as { message?: string | string[] }).message;

    response.status(status).json({
      error: Array.isArray(mensaje) ? mensaje[0] : mensaje,
    });
  }
}
