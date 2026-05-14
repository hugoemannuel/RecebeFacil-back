import { Test, TestingModule } from '@nestjs/testing';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PlanGuard } from '../common/plan.guard';

describe('ReportsController', () => {
  let controller: ReportsController;

  const mockService = {
    getSummary: jest.fn(),
    getCustomerRanking: jest.fn(),
    getRecoveryPerformance: jest.fn(),
    getForecast: jest.fn(),
  };

  const req = { user: { id: 'user-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: mockService }],
    })
      .overrideGuard(PlanGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<ReportsController>(ReportsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  it('getSummary delega para service', async () => {
    mockService.getSummary.mockResolvedValueOnce({});
    await controller.getSummary(req as any);
    expect(mockService.getSummary).toHaveBeenCalledWith('user-1');
  });

  it('getCustomers delega para service', async () => {
    mockService.getCustomerRanking.mockResolvedValueOnce([]);
    await controller.getCustomers(req as any);
    expect(mockService.getCustomerRanking).toHaveBeenCalledWith('user-1');
  });

  it('getPerformance delega para service', async () => {
    mockService.getRecoveryPerformance.mockResolvedValueOnce({});
    await controller.getPerformance(req as any);
    expect(mockService.getRecoveryPerformance).toHaveBeenCalledWith('user-1');
  });

  it('getForecast delega para service', async () => {
    mockService.getForecast.mockResolvedValueOnce([]);
    await controller.getForecast(req as any);
    expect(mockService.getForecast).toHaveBeenCalledWith('user-1');
  });
});
