/** The tests set INSTANT_TEST=1 to fake the default browser and keys, and to avoid reading real history or opening real browsers. */
export const isTestMode = (): boolean => process.env.INSTANT_TEST === '1'
