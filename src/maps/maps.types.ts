// Coordenadas geográficas en formato estándar WGS84 (el mismo que usa Google Maps y PostGIS).
// lat = latitud (norte/sur), lng = longitud (este/oeste).
export interface CoordsDto {
  lat: number;
  lng: number;
}

// Resultado de calcular un trayecto entre dos puntos.
// Guardamos tanto el valor numérico (para cálculos) como el texto (para mostrar al usuario).
export interface ResultadoTrayecto {
  distancia_metros: number;   // ej: 45200
  distancia_texto: string;    // ej: "45,2 km"
  duracion_segundos: number;  // ej: 2520
  duracion_texto: string;     // ej: "42 mins"
}

// DTO para calcular la hora de llegada dado un origen, destino y hora de salida.
export interface HoraLlegadaDto {
  origen: CoordsDto;
  destino: CoordsDto;
  hora_salida: string; // ISO 8601, ej: "2026-06-10T09:00:00Z"
}

// DTO para calcular la hora de salida necesaria para llegar a destino a una hora concreta.
// El campo origen acepta coordenadas o texto (nombre de municipio para el taxista).
export interface HoraSalidaDto {
  origen: CoordsDto | string; // coords o municipio, ej: "Jerez de la Frontera, Cádiz, España"
  destino: CoordsDto;
  hora_llegada: string; // ISO 8601
}
