export class ReturnCaseNotFoundError extends Error {
  constructor(caseId: string) {
    super(`Return case not found: ${caseId}`);
    this.name = "ReturnCaseNotFoundError";
  }
}

export class ReturnItemNotFoundError extends Error {
  constructor(itemId: string) {
    super(`Return item not found: ${itemId}`);
    this.name = "ReturnItemNotFoundError";
  }
}
