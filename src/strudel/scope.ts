import * as core from '@strudel/core';
import * as mini from '@strudel/mini';

export const baseScope = (...extra: object[]) => core.evalScope(core, mini, ...extra);
