// Mock ligero de @nestjs/common exclusivo para los tests unitarios (ver package.json > jest.moduleNameMapper).
//
// Motivo: a partir de la v12, @nestjs/common se publica como ESM puro (sin build
// CommonJS: "type": "module" y sin condición "require" en package.json > exports).
// Jest con Node 22 y ts-jest no puede hacer require() de un paquete así sin activar
// --experimental-vm-modules y reescribir el proyecto a ESM nativo — un cambio que
// afectaría también a cómo arranca la app real (nodemon/ts-node), no solo a los tests.
//
// Los tests de este repo instancian los servicios directamente (`new AuthService(mock)`),
// sin pasar por el contenedor de Nest, así que los decoradores no necesitan tener
// comportamiento real: solo deben existir y no lanzar error al evaluarse. Este mock
// no se usa nunca en la app real (dev/build/start no pasan por Jest).
function Injectable() {
  return function (target) {
    return target;
  };
}
function Global() {
  return function (target) {
    return target;
  };
}
function Module() {
  return function (target) {
    return target;
  };
}
function Catch() {
  return function (target) {
    return target;
  };
}

class HttpException extends Error {
  constructor(response, status) {
    super(typeof response === "string" ? response : JSON.stringify(response));
    this.response = response;
    this.status = status;
  }
  getStatus() {
    return this.status;
  }
  getResponse() {
    return this.response;
  }
}

class UnauthorizedException extends HttpException {
  constructor(message = "Unauthorized") {
    super({ message, error: "Unauthorized", statusCode: 401 }, 401);
  }
}

class BadRequestException extends HttpException {
  constructor(message = "Bad Request") {
    super({ message, error: "Bad Request", statusCode: 400 }, 400);
  }
}

class ForbiddenException extends HttpException {
  constructor(message = "Forbidden") {
    super({ message, error: "Forbidden", statusCode: 403 }, 403);
  }
}

class NotFoundException extends HttpException {
  constructor(message = "Not Found") {
    super({ message, error: "Not Found", statusCode: 404 }, 404);
  }
}

module.exports = {
  Injectable,
  Global,
  Module,
  Catch,
  HttpException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
};
