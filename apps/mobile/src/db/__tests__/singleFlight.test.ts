/**
 * Guards the race that made the app unusable: concurrent first-launch callers
 * each running their own unpack.
 *
 * openContentDb memoises the handle in `db`, but that is only assigned at the
 * very END — after the copy and both verification queries. Every caller that
 * arrives before then used to see null and start its own unpack, and the
 * unpack path DELETES the destination file and CLOSES handles. So one caller
 * pulled the file out from under another and the next statement got a null
 * native handle:
 *
 *     NativeDatabase.prepareAsync has been rejected
 *     -> java.lang.NullPointerException
 *
 * On the phone that showed as "Could not load your plan", Practice saying "No
 * papers yet" and Learn blank — three symptoms, one race, and no missing
 * content at all.
 *
 * Three screens (Today, Learn, Practice) mount together on launch, so three
 * concurrent callers is the real-world case, not a synthetic one.
 *
 * This models the single-flight contract directly rather than booting
 * expo-sqlite and expo-file-system under jest, which would test the mocks.
 */

describe('single-flight open', () => {
  /** The exact shape openContentDb now uses. */
  function makeOpener(work: () => Promise<string>) {
    let handle: string | null = null;
    let opening: Promise<string> | null = null;
    return async function open(): Promise<string> {
      if (handle) return handle;
      if (opening) return opening;
      opening = work();
      try {
        handle = await opening;
        return handle;
      } finally {
        opening = null;
      }
    };
  }

  it('runs the unpack ONCE for concurrent callers, and shares the handle', async () => {
    let unpacks = 0;
    const open = makeOpener(async () => {
      unpacks += 1;
      // A real copy is not instant; the race only exists because it is not.
      await new Promise((r) => setTimeout(r, 20));
      return 'handle';
    });

    const [a, b, c] = await Promise.all([open(), open(), open()]);

    expect(unpacks).toBe(1);
    expect(a).toBe('handle');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('serves later callers from the memoised handle without reopening', async () => {
    let unpacks = 0;
    const open = makeOpener(async () => {
      unpacks += 1;
      return 'handle';
    });

    await open();
    await open();
    await open();

    expect(unpacks).toBe(1);
  });

  it('lets the next caller retry after a failure', async () => {
    // The in-flight promise must be cleared on the failure path too. Holding a
    // rejected promise would fail every future call for the life of the
    // process, turning one bad copy into a permanently broken app.
    let attempts = 0;
    const open = makeOpener(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('copy failed');
      return 'handle';
    });

    await expect(open()).rejects.toThrow('copy failed');
    await expect(open()).resolves.toBe('handle');
    expect(attempts).toBe(2);
  });
});
