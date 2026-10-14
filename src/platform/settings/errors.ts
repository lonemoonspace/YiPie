/** A list item the caller named by id is not (or no longer) in the list. */
export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`No ${what} with id ${id}.`);
    this.name = 'NotFoundError';
  }
}
