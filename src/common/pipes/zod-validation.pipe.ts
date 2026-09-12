import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { ZodType } from "zod";

// Pipe de validación reutilizable para cualquier endpoint del backend.
// Equivalente en Nest a los "resultado = schema.safeParse(req.body)" que se
// repetían en cada controlador de Express. Centraliza esa lógica en un único
// sitio (principio DRY) y separa la validación del controlador (principio SRP).
//
// Uso: @Body(new ZodValidationPipe(miSchema, "Mensaje de error a mostrar")) dto: MiTipo
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(
    private readonly schema: ZodType,
    private readonly mensajeError = "Datos inválidos",
  ) {}

  transform(value: unknown) {
    const resultado = this.schema.safeParse(value);

    if (!resultado.success) {
      throw new BadRequestException({
        error: this.mensajeError,
        detalles: resultado.error.issues,
      });
    }

    return resultado.data;
  }
}
