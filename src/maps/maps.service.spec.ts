import { MapsService } from "./maps.service";

const directionsMock = jest.fn();

jest.mock("@googlemaps/google-maps-services-js", () => ({
  Client: jest.fn().mockImplementation(() => ({
    directions: directionsMock,
  })),
}));

function mockRuta(distanciaMetros: number, duracionSegundos: number) {
  return {
    data: {
      routes: [
        {
          legs: [
            {
              distance: { value: distanciaMetros, text: `${distanciaMetros / 1000} km` },
              duration: { value: duracionSegundos, text: `${Math.round(duracionSegundos / 60)} mins` },
            },
          ],
        },
      ],
    },
  };
}

describe("MapsService", () => {
  let service: MapsService;

  beforeEach(() => {
    directionsMock.mockReset();
    service = new MapsService();
  });

  it("lanza error en el constructor si falta GOOGLE_MAPS_API_KEY", () => {
    const original = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;

    expect(() => new MapsService()).toThrow("Falta la variable de entorno GOOGLE_MAPS_API_KEY");

    process.env.GOOGLE_MAPS_API_KEY = original;
  });

  describe("calcularTrayecto", () => {
    it("devuelve distancia y duración mapeadas desde la respuesta de Google Maps", async () => {
      directionsMock.mockResolvedValueOnce(mockRuta(45200, 2520));

      const resultado = await service.calcularTrayecto(
        { lat: 36.686, lng: -6.137 },
        { lat: 36.316, lng: -6.031 }
      );

      expect(resultado).toEqual({
        distancia_metros: 45200,
        distancia_texto: "45.2 km",
        duracion_segundos: 2520,
        duracion_texto: "42 mins",
      });
      expect(directionsMock).toHaveBeenCalledWith({
        params: {
          origin: "36.686,-6.137",
          destination: "36.316,-6.031",
          key: "test-google-maps-key",
        },
      });
    });

    it("lanza error si Google Maps no devuelve ninguna ruta", async () => {
      directionsMock.mockResolvedValueOnce({ data: { routes: [] } });

      await expect(
        service.calcularTrayecto({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })
      ).rejects.toThrow("No se encontró ruta entre los puntos indicados");
    });
  });

  describe("calcularHoraLlegada", () => {
    it("suma la duración del trayecto a la hora de salida", async () => {
      directionsMock.mockResolvedValueOnce(mockRuta(10000, 1800)); // 30 minutos

      const horaSalida = new Date("2026-06-10T09:00:00Z");
      const resultado = await service.calcularHoraLlegada(
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        horaSalida
      );

      expect(resultado.toISOString()).toBe("2026-06-10T09:30:00.000Z");
    });
  });

  describe("calcularHoraSalida", () => {
    it("resta la duración a la hora de llegada cuando el origen son coordenadas", async () => {
      directionsMock.mockResolvedValueOnce(mockRuta(10000, 1800)); // 30 minutos

      const horaLlegada = new Date("2026-06-10T09:30:00Z");
      const resultado = await service.calcularHoraSalida(
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        horaLlegada
      );

      expect(resultado.toISOString()).toBe("2026-06-10T09:00:00.000Z");
      expect(directionsMock).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ origin: "0,0" }) })
      );
    });

    it("pasa el municipio como texto cuando el origen es un string (taxista)", async () => {
      directionsMock.mockResolvedValueOnce(mockRuta(10000, 1800));

      await service.calcularHoraSalida(
        "Jerez de la Frontera, Cádiz, España",
        { lat: 1, lng: 1 },
        new Date("2026-06-10T09:30:00Z")
      );

      expect(directionsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ origin: "Jerez de la Frontera, Cádiz, España" }),
        })
      );
    });

    it("lanza error si Google Maps no devuelve ninguna ruta", async () => {
      directionsMock.mockResolvedValueOnce({ data: { routes: [] } });

      await expect(
        service.calcularHoraSalida({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, new Date())
      ).rejects.toThrow("No se encontró ruta entre los puntos indicados");
    });
  });
});
