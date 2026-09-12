import { Body, Controller, HttpCode, HttpStatus, InternalServerErrorException, Post, UseGuards } from "@nestjs/common";
import { MapsService } from "./maps.service";
import { AuthGuard } from "../auth/auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { trayectoSchema, TrayectoDto, horaLlegadaSchema, HoraLlegadaDto, horaSalidaSchema, HoraSalidaDto } from "./dto/maps.dto";

// Rutas de mapas — todas protegidas con JWT (evita abuso de la API de Google).
@Controller("maps")
@UseGuards(AuthGuard)
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  // POST /maps/trayecto
  // Devuelve la distancia y duración estimada entre dos puntos.
  // Llamado desde el frontend al crear una reserva para mostrar al cliente el tiempo del viaje.
  @Post("trayecto")
  @HttpCode(HttpStatus.OK)
  async trayecto(@Body(new ZodValidationPipe(trayectoSchema)) dto: TrayectoDto) {
    try {
      return await this.mapsService.calcularTrayecto(dto.origen, dto.destino);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al calcular el trayecto";
      throw new InternalServerErrorException(mensaje);
    }
  }

  // POST /maps/hora-llegada
  // Dado un origen, destino y hora de salida, devuelve cuándo se llega.
  // Útil para el cliente que introduce "salgo a las 9:00, ¿a qué hora llego?".
  @Post("hora-llegada")
  @HttpCode(HttpStatus.OK)
  async horaLlegada(@Body(new ZodValidationPipe(horaLlegadaSchema)) dto: HoraLlegadaDto) {
    try {
      const horaLlegada = await this.mapsService.calcularHoraLlegada(
        dto.origen,
        dto.destino,
        new Date(dto.hora_salida),
      );
      return {
        hora_llegada_estimada: horaLlegada.toISOString(),
        aviso: "Tiempo estimado. Se recomienda añadir unos 30 minutos de margen.",
      };
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al calcular la hora de llegada";
      throw new InternalServerErrorException(mensaje);
    }
  }

  // POST /maps/hora-salida
  // Dado un origen, destino y hora de llegada deseada, devuelve a qué hora debe salir.
  // Útil para el cliente que introduce "quiero llegar a las 10:00, ¿cuándo salgo?".
  // También se usa internamente para calcular hora_salida_estimada_taxista al aceptar una reserva.
  @Post("hora-salida")
  @HttpCode(HttpStatus.OK)
  async horaSalida(@Body(new ZodValidationPipe(horaSalidaSchema)) dto: HoraSalidaDto) {
    try {
      const horaSalida = await this.mapsService.calcularHoraSalida(
        dto.origen,
        dto.destino,
        new Date(dto.hora_llegada),
      );
      return {
        hora_salida_estimada: horaSalida.toISOString(),
        aviso: "Tiempo estimado. Se recomienda añadir unos 30 minutos de margen.",
      };
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al calcular la hora de salida";
      throw new InternalServerErrorException(mensaje);
    }
  }
}
