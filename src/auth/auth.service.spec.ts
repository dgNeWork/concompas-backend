import { AuthService } from "./auth.service";
import { RegistroDto } from "./dto/registro.dto";
import { LoginDto } from "./dto/login.dto";
import { createQueryBuilder, createSupabaseServiceMock, ok, fail } from "../test-utils/supabase-mock";

describe("AuthService", () => {
  let supabaseServiceMock: ReturnType<typeof createSupabaseServiceMock>;
  let service: AuthService;

  const registroClienteDto: RegistroDto = {
    email: "cliente@example.com",
    password: "Abcdefg1!",
    nombre: "Ana",
    apellidos: "García",
    documento_identidad: "12345678A",
    telefono: "612345678",
    rol: "cliente",
  };

  const registroTaxistaDto: RegistroDto = {
    ...registroClienteDto,
    email: "taxista@example.com",
    rol: "taxista",
  };

  beforeEach(() => {
    supabaseServiceMock = createSupabaseServiceMock();
    service = new AuthService(supabaseServiceMock as any);
  });

  describe("registrar", () => {
    it("crea usuario, perfil base y perfil de cliente cuando rol es cliente", async () => {
      supabaseServiceMock.admin.auth.admin.createUser.mockResolvedValueOnce({
        data: { user: { id: "user-1" } },
        error: null,
      });
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(null))) // profiles
        .mockReturnValueOnce(createQueryBuilder(ok(null))); // clientes_perfil

      const resultado = await service.registrar(registroClienteDto);

      expect(resultado).toEqual({
        id: "user-1",
        email: registroClienteDto.email,
        rol: "cliente",
        nombre: "Ana",
        apellidos: "García",
      });
      expect(supabaseServiceMock.admin.from).toHaveBeenNthCalledWith(1, "profiles");
      expect(supabaseServiceMock.admin.from).toHaveBeenNthCalledWith(2, "clientes_perfil");
      expect(supabaseServiceMock.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    });

    it("crea usuario, perfil base y perfil de taxista cuando rol es taxista", async () => {
      supabaseServiceMock.admin.auth.admin.createUser.mockResolvedValueOnce({
        data: { user: { id: "user-2" } },
        error: null,
      });
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(null))) // profiles
        .mockReturnValueOnce(createQueryBuilder(ok(null))); // taxistas_perfil

      const resultado = await service.registrar(registroTaxistaDto);

      expect(resultado.rol).toBe("taxista");
      expect(supabaseServiceMock.admin.from).toHaveBeenNthCalledWith(2, "taxistas_perfil");
    });

    it("lanza error si falla la creación en Supabase Auth y no toca la tabla profiles", async () => {
      supabaseServiceMock.admin.auth.admin.createUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: "El email ya está registrado" },
      });

      await expect(service.registrar(registroClienteDto)).rejects.toThrow(
        "El email ya está registrado"
      );
      expect(supabaseServiceMock.admin.from).not.toHaveBeenCalled();
    });

    it("revierte el usuario de auth si falla la creación del perfil base", async () => {
      supabaseServiceMock.admin.auth.admin.createUser.mockResolvedValueOnce({
        data: { user: { id: "user-3" } },
        error: null,
      });
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(fail("columna nombre no puede ser null"))
      );

      await expect(service.registrar(registroClienteDto)).rejects.toThrow(
        "Error al crear el perfil: columna nombre no puede ser null"
      );
      expect(supabaseServiceMock.admin.auth.admin.deleteUser).toHaveBeenCalledWith("user-3");
    });

    it("revierte el usuario de auth si falla la creación del perfil de cliente", async () => {
      supabaseServiceMock.admin.auth.admin.createUser.mockResolvedValueOnce({
        data: { user: { id: "user-4" } },
        error: null,
      });
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(null))) // profiles
        .mockReturnValueOnce(createQueryBuilder(fail("violates foreign key"))); // clientes_perfil

      await expect(service.registrar(registroClienteDto)).rejects.toThrow(
        "Error al crear el perfil de cliente: violates foreign key"
      );
      expect(supabaseServiceMock.admin.auth.admin.deleteUser).toHaveBeenCalledWith("user-4");
    });

    it("revierte el usuario de auth si falla la creación del perfil de taxista", async () => {
      supabaseServiceMock.admin.auth.admin.createUser.mockResolvedValueOnce({
        data: { user: { id: "user-5" } },
        error: null,
      });
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(null))) // profiles
        .mockReturnValueOnce(createQueryBuilder(fail("violates foreign key"))); // taxistas_perfil

      await expect(service.registrar(registroTaxistaDto)).rejects.toThrow(
        "Error al crear el perfil de taxista: violates foreign key"
      );
      expect(supabaseServiceMock.admin.auth.admin.deleteUser).toHaveBeenCalledWith("user-5");
    });
  });

  describe("login", () => {
    const loginDto: LoginDto = { email: "ana@example.com", password: "Abcdefg1!" };

    it("devuelve tokens y datos de usuario en un login correcto", async () => {
      supabaseServiceMock.client.auth.signInWithPassword.mockResolvedValueOnce({
        data: {
          session: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
          user: { id: "user-1", email: loginDto.email },
        },
        error: null,
      });
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ rol: "cliente", nombre: "Ana", apellidos: "García" }))
      );

      const resultado = await service.login(loginDto);

      expect(resultado).toEqual({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        user: {
          id: "user-1",
          email: loginDto.email,
          rol: "cliente",
          nombre: "Ana",
          apellidos: "García",
        },
      });
    });

    it("lanza error si las credenciales son incorrectas", async () => {
      supabaseServiceMock.client.auth.signInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { message: "Invalid login credentials" },
      });

      await expect(service.login(loginDto)).rejects.toThrow("Invalid login credentials");
    });

    it("lanza error si no logra leer el perfil tras el login", async () => {
      supabaseServiceMock.client.auth.signInWithPassword.mockResolvedValueOnce({
        data: {
          session: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
          user: { id: "user-1", email: loginDto.email },
        },
        error: null,
      });
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(fail("not found")));

      await expect(service.login(loginDto)).rejects.toThrow(
        "Error al obtener el perfil del usuario"
      );
    });
  });

  describe("logout", () => {
    it("cierra sesión sin lanzar error cuando Supabase no devuelve error", async () => {
      supabaseServiceMock.admin.auth.admin.signOut.mockResolvedValueOnce({ error: null });

      await expect(service.logout("token-valido")).resolves.toBeUndefined();
      expect(supabaseServiceMock.admin.auth.admin.signOut).toHaveBeenCalledWith("token-valido");
    });

    it("lanza error si Supabase falla al cerrar sesión", async () => {
      supabaseServiceMock.admin.auth.admin.signOut.mockResolvedValueOnce({
        error: { message: "token ya revocado" },
      });

      await expect(service.logout("token-invalido")).rejects.toThrow(
        "Error al cerrar la sesión: token ya revocado"
      );
    });
  });

  describe("verificarToken", () => {
    it("devuelve los datos del usuario cuando el token es válido", async () => {
      supabaseServiceMock.admin.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: "user-1", email: "ana@example.com" } },
        error: null,
      });
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ rol: "cliente", nombre: "Ana", apellidos: "García" }))
      );

      const resultado = await service.verificarToken("token-valido");

      expect(resultado).toEqual({
        id: "user-1",
        email: "ana@example.com",
        rol: "cliente",
        nombre: "Ana",
        apellidos: "García",
      });
    });

    it("lanza error si el token no es válido", async () => {
      supabaseServiceMock.admin.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: "jwt expired" },
      });

      await expect(service.verificarToken("token-caducado")).rejects.toThrow(
        "Token inválido o expirado"
      );
    });

    it("lanza error si el usuario no tiene perfil", async () => {
      supabaseServiceMock.admin.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: "user-1", email: "ana@example.com" } },
        error: null,
      });
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(fail("not found")));

      await expect(service.verificarToken("token-valido")).rejects.toThrow(
        "Perfil de usuario no encontrado"
      );
    });
  });
});
