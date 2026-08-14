// הצהרות טיפוסים ל-seed-stats.mjs עבור בדיקות ה-TS שמייבאות אותו.
import type postgres from 'postgres';

export declare const V1: string;
export declare const V2: string;
export declare const CONFIG_V1: unknown;
export declare const CONFIG_V2: unknown;
export declare function seedDemo(sql: ReturnType<typeof postgres>): Promise<number>;
