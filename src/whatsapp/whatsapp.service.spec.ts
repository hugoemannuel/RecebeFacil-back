import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppService } from './whatsapp.service';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('WhatsAppService', () => {
  let service: WhatsAppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WhatsAppService],
    }).compile();
    service = module.get<WhatsAppService>(WhatsAppService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(service).toBeDefined());

  describe('sendText', () => {
    it('deve fazer log e retornar sem chamar fetch quando env vars não estão configuradas', async () => {
      delete process.env.ZAPI_INSTANCE_ID;
      delete process.env.ZAPI_INSTANCE_TOKEN;
      delete process.env.ZAPI_CLIENT_TOKEN;

      await expect(service.sendText('11999', 'Olá!')).resolves.not.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('deve chamar fetch com payload correto quando env vars estão configuradas', async () => {
      process.env.ZAPI_INSTANCE_ID = 'inst-1';
      process.env.ZAPI_INSTANCE_TOKEN = 'tok-1';
      process.env.ZAPI_CLIENT_TOKEN = 'cli-tok';

      mockFetch.mockResolvedValueOnce({ ok: true });

      await service.sendText('11999', 'Olá!');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('inst-1'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Client-Token': 'cli-tok' }),
          body: expect.stringContaining('11999'),
        }),
      );

      delete process.env.ZAPI_INSTANCE_ID;
      delete process.env.ZAPI_INSTANCE_TOKEN;
      delete process.env.ZAPI_CLIENT_TOKEN;
    });

    it('deve lançar erro quando fetch retorna status não-ok', async () => {
      process.env.ZAPI_INSTANCE_ID = 'inst-1';
      process.env.ZAPI_INSTANCE_TOKEN = 'tok-1';
      process.env.ZAPI_CLIENT_TOKEN = 'cli-tok';

      mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

      await expect(service.sendText('11999', 'Olá!')).rejects.toThrow('Falha ao enviar mensagem');

      delete process.env.ZAPI_INSTANCE_ID;
      delete process.env.ZAPI_INSTANCE_TOKEN;
      delete process.env.ZAPI_CLIENT_TOKEN;
    });

    it('deve usar credenciais explícitas quando fornecidas (multitenancy)', async () => {
      delete process.env.ZAPI_INSTANCE_ID;
      mockFetch.mockResolvedValueOnce({ ok: true });

      const credentials = { instanceId: 'lojista-inst', token: 'lojista-tok', clientToken: 'cli-tok' };
      await service.sendText('5511999', 'Msg', credentials);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('lojista-inst'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'Client-Token': 'cli-tok' }),
        }),
      );
    });

    it('deve usar env vars como fallback quando credenciais não fornecidas', async () => {
      process.env.ZAPI_INSTANCE_ID = 'env-inst';
      process.env.ZAPI_INSTANCE_TOKEN = 'env-tok';
      process.env.ZAPI_CLIENT_TOKEN = 'env-cli';

      mockFetch.mockResolvedValueOnce({ ok: true });
      await service.sendText('5511999', 'Msg');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('env-inst'),
        expect.any(Object),
      );

      delete process.env.ZAPI_INSTANCE_ID;
      delete process.env.ZAPI_INSTANCE_TOKEN;
      delete process.env.ZAPI_CLIENT_TOKEN;
    });
  });
});
