import { Test, TestingModule } from '@nestjs/testing';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

describe('DemoController', () => {
  let controller: DemoController;

  const mockService = { sendDemo: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DemoController],
      providers: [{ provide: DemoService, useValue: mockService }],
    }).compile();
    controller = module.get<DemoController>(DemoController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  it('deve extrair IP do header x-forwarded-for e delegar para service', async () => {
    const req = { headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' }, ip: '127.0.0.1' };
    const dto: any = { phone: '11999', name: 'Teste', message: 'Olá' };
    mockService.sendDemo.mockResolvedValueOnce({ success: true });

    await controller.send(dto, req as any);
    expect(mockService.sendDemo).toHaveBeenCalledWith('10.0.0.1', '11999', 'Teste', 'Olá');
  });

  it('deve usar req.ip quando x-forwarded-for não está presente', async () => {
    const req = { headers: {}, ip: '192.168.0.1' };
    const dto: any = { phone: '11999', name: 'X', message: 'Msg' };
    mockService.sendDemo.mockResolvedValueOnce({ success: true });

    await controller.send(dto, req as any);
    expect(mockService.sendDemo).toHaveBeenCalledWith('192.168.0.1', '11999', 'X', 'Msg');
  });

  it('deve usar string vazia como IP fallback quando nem header nem req.ip', async () => {
    const req = { headers: {}, ip: undefined };
    const dto: any = { phone: '11999', name: 'X', message: 'Y' };
    mockService.sendDemo.mockResolvedValueOnce({});

    await controller.send(dto, req as any);
    expect(mockService.sendDemo).toHaveBeenCalledWith('', '11999', 'X', 'Y');
  });
});
