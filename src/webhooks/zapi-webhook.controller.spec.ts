import { Test, TestingModule } from '@nestjs/testing';
import { ZapiWebhookController } from './zapi-webhook.controller';
import { ZapiWebhookService } from './zapi-webhook.service';

describe('ZapiWebhookController', () => {
  let controller: ZapiWebhookController;

  const mockService = { handle: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ZapiWebhookController],
      providers: [{ provide: ZapiWebhookService, useValue: mockService }],
    }).compile();
    controller = module.get<ZapiWebhookController>(ZapiWebhookController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  it('deve chamar service.handle e retornar { ok: true }', async () => {
    mockService.handle.mockResolvedValueOnce(undefined);
    const payload = { phone: '5511@c.us', type: 'ReceivedCallback', fromMe: false, text: { message: 'PARAR' } };

    const result = await controller.handle(payload as any);

    expect(mockService.handle).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ ok: true });
  });

  it('deve retornar { ok: true } mesmo sem match de opt-out (service não lança erro)', async () => {
    mockService.handle.mockResolvedValueOnce(undefined);
    const payload = { phone: '5511@c.us', type: 'ReceivedCallback', fromMe: false, text: { message: 'Oi' } };

    const result = await controller.handle(payload as any);

    expect(result).toEqual({ ok: true });
  });
});
