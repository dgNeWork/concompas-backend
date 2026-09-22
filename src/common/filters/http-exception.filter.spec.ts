import { HttpException, BadRequestException, UnauthorizedException } from "@nestjs/common";
import { HttpExceptionFilter } from "./http-exception.filter";

function createHost() {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as any;
  return { host, response };
}

describe("HttpExceptionFilter", () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it("respeta tal cual el cuerpo cuando no trae la clave 'message' (formato del ZodValidationPipe)", () => {
    const { host, response } = createHost();
    const exception = new HttpException(
      { error: "Datos inválidos", detalles: ["el email no es válido"] },
      400
    );

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: "Datos inválidos",
      detalles: ["el email no es válido"],
    });
  });

  it("normaliza a { error } cuando el cuerpo trae 'message' como string", () => {
    const { host, response } = createHost();
    const exception = new UnauthorizedException("No autorizado: token inválido o expirado");

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      error: "No autorizado: token inválido o expirado",
    });
  });

  it("se queda con el primer mensaje cuando 'message' es un array", () => {
    const { host, response } = createHost();
    const exception = new BadRequestException(["el nombre es obligatorio", "el email no es válido"]);

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: "el nombre es obligatorio" });
  });

  it("normaliza a { error } cuando el cuerpo de la excepción es directamente un string", () => {
    const { host, response } = createHost();
    const exception = new HttpException("mensaje plano", 403);

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: "mensaje plano" });
  });
});
