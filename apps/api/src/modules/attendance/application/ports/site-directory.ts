/**
 * Lo que `attendance` necesita saber de una sede, en SUS propios términos
 * (el adaptador es el único que conoce a organization).
 */
export interface DeviceSite {
  id: string;
  timeZone: string;
  active: boolean;
}

export interface SiteDirectory {
  find(siteId: string): Promise<DeviceSite | null>;
}
