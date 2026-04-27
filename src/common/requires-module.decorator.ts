import { SetMetadata } from '@nestjs/common';

export const MODULE_KEY = 'required_module';

/**
 * Decorator que marca qual módulo um controller/rota requer.
 * Ex: @RequiresModule('CLIENTS')
 */
export const RequiresModule = (module: string) => SetMetadata(MODULE_KEY, module);
