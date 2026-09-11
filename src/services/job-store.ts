export type JobRecord<T> = T & { id: string };

const jobs = new Map<string, JobRecord<unknown>>();

export function saveJob<T extends { id: string }>(job: T) {
  jobs.set(job.id, job);
  return job;
}

export function findJob<T extends { id: string }>(id: string) {
  return jobs.get(id) as T | undefined;
}

export function updateJob<T extends { id: string }>(job: T) {
  jobs.set(job.id, job);
  return job;
}
