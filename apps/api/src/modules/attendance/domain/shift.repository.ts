import type { Result } from '@rrhh/domain';

import type { ShiftAlreadyExistsError } from './errors';
import type { Shift, ShiftId } from './shift';

export interface ShiftRepository {
  findById(id: ShiftId): Promise<Shift | null>;
  /** Alta de un turno nuevo. Un nombre repetido en la empresa retorna err; fallas de IO rechazan. */
  add(shift: Shift): Promise<Result<void, ShiftAlreadyExistsError>>;
}
