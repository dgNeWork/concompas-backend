import { AuthGuard } from "./auth.guard";
import { UsuarioAutenticado } from "./auth.types";

function createContext(authHeader?: string) {
  const request: { headers: { authorization?: string }; usuario?: UsuarioAutenticado } = {
    headers: { authorization: authHeader },
  };
  return {
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any,
    request,
  };
}

describe("AuthGuard", () => {
  let authServiceMock: { verificarToken: jest.Mock };
  let guard: AuthGuard;

  beforeEach(() => {
    authServiceMock = { verificarToken: jest.fn() };
    guard = new AuthGuard(authServiceMock as any);
  });

  it("rechaza la petición si no hay cabecera de autorización", async () => {
    const { context } = createContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(
      "No autorizado: falta el token de autenticación"
    );
    expect(authServiceMock.verificarToken).not.toHaveBeenCalled();
  });

  it("rechaza la petición si la cabecera no empieza por 'Bearer '", async () => {
    const { context } = createContext("Token abc123");

    await expect(guard.canActivate(context)).rejects.toThrow(
      "No autorizado: falta el token de autenticación"
    );
  });

  it("rechaza la petición si el token no es válido", async () => {
    const { context } = createContext("Bearer token-caducado");
    authServiceMock.verificarToken.mockRejectedValueOnce(new Error("Token inválido o expirado"));

    await expect(guard.canActivate(context)).rejects.toThrow(
      "No autorizado: token inválido o expirado"
    );
  });

  it("permite el acceso y adjunta el usuario a la request si el token es válido", async () => {
    const { context, request } = createContext("Bearer token-valido");
    const usuario: UsuarioAutenticado = {
      id: "user-1",
      email: "ana@example.com",
      rol: "cliente",
      nombre: "Ana",
      apellidos: "García",
    };
    authServiceMock.verificarToken.mockResolvedValueOnce(usuario);

    const resultado = await guard.canActivate(context);

    expect(resultado).toBe(true);
    expect(authServiceMock.verificarToken).toHaveBeenCalledWith("token-valido");
    expect(request.usuario).toEqual(usuario);
  });
});
