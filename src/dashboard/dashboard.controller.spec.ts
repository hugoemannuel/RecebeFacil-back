import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController', () => {
  let controller: DashboardController;

  const mockService = { getMetrics: jest.fn() };
  const req = { user: { id: 'user-1', name: 'João' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: mockService }],
    }).compile();
    controller = module.get<DashboardController>(DashboardController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  it('getMetrics delega para service e retorna user.name', async () => {
    const metrics = { summary: {}, topClients: [], chart: [], recentActivity: [], actionNecessary: 0 };
    mockService.getMetrics.mockResolvedValueOnce(metrics);

    const result = await controller.getMetrics(req as any, '7days', 'PAID');

    expect(mockService.getMetrics).toHaveBeenCalledWith('user-1', '7days', 'PAID');
    expect(result.user.name).toBe('João');
  });

  it('getMetrics filtra status inválido e passa undefined', async () => {
    mockService.getMetrics.mockResolvedValueOnce({});
    await controller.getMetrics(req as any, undefined, 'INVALIDO');
    expect(mockService.getMetrics).toHaveBeenCalledWith('user-1', undefined, undefined);
  });

  it('getMetrics funciona sem query params', async () => {
    mockService.getMetrics.mockResolvedValueOnce({});
    await controller.getMetrics(req as any, undefined, undefined);
    expect(mockService.getMetrics).toHaveBeenCalledWith('user-1', undefined, undefined);
  });
});
