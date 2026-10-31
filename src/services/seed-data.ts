import { readFileSync } from 'fs';
import { createPerson, addPersonAlias, getAllPersons } from './database.js';

export interface PersonSeed {
  displayName: string;
  canonicalName: string;
  aliases?: string[];
  isFamily?: boolean;
}

export function parsePeopleFile(json: string): PersonSeed[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) {
    throw new Error('expected a JSON array of people');
  }
  return data.map((entry, i) => {
    const person = entry as Partial<PersonSeed>;
    if (typeof person.displayName !== 'string' || typeof person.canonicalName !== 'string') {
      throw new Error(`entry ${i}: displayName and canonicalName are required strings`);
    }
    if (person.aliases !== undefined && !(Array.isArray(person.aliases) && person.aliases.every((a) => typeof a === 'string'))) {
      throw new Error(`entry ${i}: aliases must be an array of strings`);
    }
    return { displayName: person.displayName, canonicalName: person.canonicalName, aliases: person.aliases ?? [], isFamily: person.isFamily ?? true };
  });
}

/**
 * Seeds the persons table from PEOPLE_FILE (see people.example.json) on first start only,
 * so the classifier can match name variants to household members from the first document.
 */
export function seedPeople(peopleFile = process.env.PEOPLE_FILE): void {
  if (!peopleFile) {
    return;
  }

  const existing = getAllPersons();
  if (existing.length > 0) {
    console.log(`[Seed] Persons table already has ${existing.length} entries, skipping ${peopleFile}`);
    return;
  }

  const people = parsePeopleFile(readFileSync(peopleFile, 'utf-8'));
  console.log(`[Seed] Seeding ${people.length} people from ${peopleFile}...`);

  for (const person of people) {
    try {
      const personId = createPerson(person.displayName, person.canonicalName, person.isFamily);

      // The canonical name is added as an alias automatically
      for (const alias of person.aliases ?? []) {
        if (alias !== person.canonicalName) {
          addPersonAlias(personId, alias);
        }
      }

      console.log(`[Seed] Created: ${person.displayName} (${(person.aliases?.length ?? 0) + 1} aliases)`);
    } catch (err) {
      console.error(`[Seed] Failed to create ${person.displayName}:`, err);
    }
  }
}
