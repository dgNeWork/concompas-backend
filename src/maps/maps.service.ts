import { Client } from "@googlemaps/google-maps-services-js";
import { CoordsDto, ResultadoTrayecto } from "./maps.types";

// MapsService encapsula todas las llamadas a la API de Google Maps Directions.
// El resto del sistema (trayectos, cancelaciones) usa este servicio sin conocer
// los detalles de la API externa. Principio SRP + DIP.
export class MapsService {
  private client: Client;
  private apiKey: string;

  constructor() {
    this.client = new Client({});

    if (!process.env.GOOGLE_MAPS_API_KEY) {
      throw new Error("Falta la variable de entorno GOOGLE_MAPS_API_KEY");
    }

    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
  }

  // Calcula la distancia y duración entre dos puntos geográficos.
  // Es la llamada base que usan los demás métodos internamente.
  // Usada al crear una reserva para mostrar al cliente el tiempo estimado del trayecto.
  async calcularTrayecto(origen: CoordsDto, destino: CoordsDto): Promise<ResultadoTrayecto> {
    const response = await this.client.directions({
      params: {
        origin: `${origen.lat},${origen.lng}`,
        destination: `${destino.lat},${destino.lng}`,
        key: this.apiKey,
      },
    });

    const ruta = response.data.routes[0];

    if (!ruta) {
      throw new Error("No se encontró ruta entre los puntos indicados");
    }

    const tramo = ruta.legs[0];

    return {
      distancia_metros: tramo.distance.value,
      distancia_texto: tramo.distance.text,
      duracion_segundos: tramo.duration.value,
      duracion_texto: tramo.duration.text,
    };
  }

  // Calcula la hora estimada de llegada sumando la duración del trayecto a la hora de salida.
  // Usada en el frontend cuando el cliente introduce la hora a la que sale y quiere saber
  // cuándo llega (con aviso de que es estimado y se recomienda ~30 min de margen).
  async calcularHoraLlegada(origen: CoordsDto, destino: CoordsDto, horaSalida: Date): Promise<Date> {
    const { duracion_segundos } = await this.calcularTrayecto(origen, destino);
    return new Date(horaSalida.getTime() + duracion_segundos * 1000);
  }

  // Calcula a qué hora debe salir el taxista desde su punto de origen para llegar
  // al destino a una hora concreta. Restamos la duración a la hora de llegada deseada.
  //
  // El origen puede ser:
  //   - CoordsDto: coordenadas exactas (cuando tenemos la posición del taxista)
  //   - string: nombre del municipio (ej: "Jerez de la Frontera, Cádiz, España")
  //     Google Maps lo geocodifica internamente. Es la forma en que calculamos
  //     hora_salida_estimada_taxista cuando acepta una reserva.
  async calcularHoraSalida(
    origen: CoordsDto | string,
    destino: CoordsDto,
    horaLlegada: Date
  ): Promise<Date> {
    const origenParam =
      typeof origen === "string"
        ? origen
        : `${origen.lat},${origen.lng}`;

    const response = await this.client.directions({
      params: {
        origin: origenParam,
        destination: `${destino.lat},${destino.lng}`,
        key: this.apiKey,
      },
    });

    const ruta = response.data.routes[0];

    if (!ruta) {
      throw new Error("No se encontró ruta entre los puntos indicados");
    }

    const duracionSegundos = ruta.legs[0].duration.value;
    return new Date(horaLlegada.getTime() - duracionSegundos * 1000);
  }
}

export const mapsService = new MapsService();
