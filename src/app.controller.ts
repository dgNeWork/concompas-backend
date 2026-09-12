import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  // GET / — healthcheck para verificar que el servidor está en pie
  @Get()
  healthcheck() {
    return { message: "ConCompas API funcionando" };
  }
}
