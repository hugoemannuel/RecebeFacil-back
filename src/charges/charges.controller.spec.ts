import { Test, TestingModule } from '@nestjs/testing';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';

describe('ChargesController', () => {
  let controller: ChargesController;

  const mockService = {
    findAll: jest.fn(),
    findAllRecurring: jest.fn(),
    findOneRecurring: jest.fn(),
    findOne: jest.fn(),
    createCharge: jest.fn(),
    bulkCancel: jest.fn(),
    bulkRemind: jest.fn(),
    hardDeleteCharge: jest.fn(),
    deleteRecurring: jest.fn(),
    cancelCharge: jest.fn(),
    cancelRecurring: jest.fn(),
    reactivateRecurring: jest.fn(),
    automateCharge: jest.fn(),
    updateChargeStatus: jest.fn(),
    updateRecurring: jest.fn(),
  };

  const req = { user: { id: 'user-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChargesController],
      providers: [{ provide: ChargesService, useValue: mockService }],
    }).compile();
    controller = module.get<ChargesController>(ChargesController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  it('findAll delega para service', async () => {
    mockService.findAll.mockResolvedValueOnce([]);
    await controller.findAll(req as any);
    expect(mockService.findAll).toHaveBeenCalledWith('user-1');
  });

  it('findAllRecurring delega para service', async () => {
    mockService.findAllRecurring.mockResolvedValueOnce([]);
    await controller.findAllRecurring(req as any);
    expect(mockService.findAllRecurring).toHaveBeenCalledWith('user-1');
  });

  it('findOneRecurring delega para service', async () => {
    mockService.findOneRecurring.mockResolvedValueOnce({});
    await controller.findOneRecurring(req as any, 'r1');
    expect(mockService.findOneRecurring).toHaveBeenCalledWith('user-1', 'r1');
  });

  it('findOne delega para service', async () => {
    mockService.findOne.mockResolvedValueOnce({});
    await controller.findOne(req as any, 'c1');
    expect(mockService.findOne).toHaveBeenCalledWith('user-1', 'c1');
  });

  it('createCharge delega para service', async () => {
    const dto: any = { amount: 100 };
    mockService.createCharge.mockResolvedValueOnce({ success: true });
    await controller.createCharge(req as any, dto);
    expect(mockService.createCharge).toHaveBeenCalledWith('user-1', dto);
  });

  it('bulkCancel delega para service', async () => {
    mockService.bulkCancel.mockResolvedValueOnce({ count: 2 });
    await controller.bulkCancel(req as any, { chargeIds: ['c1', 'c2'] });
    expect(mockService.bulkCancel).toHaveBeenCalledWith('user-1', ['c1', 'c2']);
  });

  it('bulkRemind delega para service', async () => {
    mockService.bulkRemind.mockResolvedValueOnce({ count: 1 });
    await controller.bulkRemind(req as any, { chargeIds: ['c1'] });
    expect(mockService.bulkRemind).toHaveBeenCalledWith('user-1', ['c1']);
  });

  it('hardDeleteCharge delega para service', async () => {
    mockService.hardDeleteCharge.mockResolvedValueOnce({ success: true });
    await controller.hardDeleteCharge(req as any, 'c1');
    expect(mockService.hardDeleteCharge).toHaveBeenCalledWith('user-1', 'c1');
  });

  it('deleteRecurring delega para service', async () => {
    mockService.deleteRecurring.mockResolvedValueOnce({ success: true });
    await controller.deleteRecurring(req as any, 'r1');
    expect(mockService.deleteRecurring).toHaveBeenCalledWith('user-1', 'r1');
  });

  it('deleteCharge delega cancelCharge no service', async () => {
    mockService.cancelCharge.mockResolvedValueOnce({ success: true });
    await controller.deleteCharge(req as any, 'c1');
    expect(mockService.cancelCharge).toHaveBeenCalledWith('user-1', 'c1');
  });

  it('cancelRecurring delega para service', async () => {
    mockService.cancelRecurring.mockResolvedValueOnce({ success: true });
    await controller.cancelRecurring(req as any, 'r1');
    expect(mockService.cancelRecurring).toHaveBeenCalledWith('user-1', 'r1');
  });

  it('reactivateRecurring delega para service', async () => {
    mockService.reactivateRecurring.mockResolvedValueOnce({ success: true });
    await controller.reactivateRecurring(req as any, 'r1');
    expect(mockService.reactivateRecurring).toHaveBeenCalledWith('user-1', 'r1');
  });

  it('automateCharge delega para service', async () => {
    const dto: any = { frequency: 'MONTHLY' };
    mockService.automateCharge.mockResolvedValueOnce({ success: true });
    await controller.automateCharge(req as any, 'c1', dto);
    expect(mockService.automateCharge).toHaveBeenCalledWith('user-1', 'c1', dto);
  });

  it('updateStatus delega para service', async () => {
    const dto: any = { status: 'PAID' };
    mockService.updateChargeStatus.mockResolvedValueOnce({ success: true });
    await controller.updateStatus(req as any, 'c1', dto);
    expect(mockService.updateChargeStatus).toHaveBeenCalledWith('user-1', 'c1', 'PAID');
  });

  it('updateRecurring delega para service', async () => {
    const dto: any = { description: 'X' };
    mockService.updateRecurring.mockResolvedValueOnce({ success: true });
    await controller.updateRecurring(req as any, 'r1', dto);
    expect(mockService.updateRecurring).toHaveBeenCalledWith('user-1', 'r1', dto);
  });
});
