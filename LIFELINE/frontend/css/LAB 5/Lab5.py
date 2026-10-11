"""
PAGE REPLACEMENT ALGORITHMS
============================
Implements FIFO, LRU, and Optimal page replacement algorithms.
Calculates page hits, page faults, and hit/fault ratio for each.

Related Viva Questions:
1) Page Fault - occurs when a program tries to access a page that is not
   currently loaded in main memory (RAM). The OS must fetch it from disk.
2) Paging - a memory management scheme that eliminates the need for
   contiguous allocation by dividing memory into fixed-size blocks called
   "pages" (logical) and "frames" (physical).
3) Page Hit - when the requested page IS found in memory (no fault).
   Page Hit Rate = Hits / Total References
   Page Fault Rate = Faults / Total References
4) Page Replacement Algorithms - FIFO, LRU (Least Recently Used),
   Optimal (MIN), LFU, MFU, Second Chance / Clock, etc.
5) Best Algorithm - Optimal (MIN) is theoretically the best (lowest
   possible fault rate) since it replaces the page not needed for the
   longest time in the future. But it's not implementable in practice
   because it needs future knowledge. Among practical algorithms, LRU
   generally performs best since it approximates Optimal using past
   behavior (locality of reference).
"""


def fifo(pages, capacity):
    """First-In-First-Out page replacement."""
    frames = []
    faults = 0
    hits = 0
    history = []

    for page in pages:
        if page in frames:
            hits += 1
            history.append((page, list(frames), "HIT"))
        else:
            faults += 1
            if len(frames) < capacity:
                frames.append(page)
            else:
                frames.pop(0)      # remove the oldest inserted page
                frames.append(page)
            history.append((page, list(frames), "FAULT"))

    return faults, hits, history


def lru(pages, capacity):
    """Least Recently Used page replacement."""
    frames = []
    faults = 0
    hits = 0
    history = []

    for page in pages:
        if page in frames:
            hits += 1
            frames.remove(page)
            frames.append(page)    # move to most-recently-used end
            history.append((page, list(frames), "HIT"))
        else:
            faults += 1
            if len(frames) < capacity:
                frames.append(page)
            else:
                frames.pop(0)       # remove least recently used (front)
                frames.append(page)
            history.append((page, list(frames), "FAULT"))

    return faults, hits, history


def optimal(pages, capacity):
    """Optimal (MIN) page replacement - uses future knowledge."""
    frames = []
    faults = 0
    hits = 0
    history = []

    for i, page in enumerate(pages):
        if page in frames:
            hits += 1
            history.append((page, list(frames), "HIT"))
        else:
            faults += 1
            if len(frames) < capacity:
                frames.append(page)
            else:
                future = pages[i + 1:]
                farthest_index = -1
                page_to_replace = frames[0]

                for f in frames:
                    if f not in future:
                        page_to_replace = f
                        break
                    else:
                        idx = future.index(f)
                        if idx > farthest_index:
                            farthest_index = idx
                            page_to_replace = f

                frames[frames.index(page_to_replace)] = page
            history.append((page, list(frames), "FAULT"))

    return faults, hits, history


def print_report(name, pages, capacity, faults, hits, history):
    total = len(pages)
    print(f"\n{'=' * 55}")
    print(f"Algorithm: {name}")
    print(f"{'=' * 55}")
    print(f"{'Ref':<6}{'Frames':<25}{'Status'}")
    print("-" * 55)
    for page, frame_state, status in history:
        print(f"{page:<6}{str(frame_state):<25}{status}")

    print("-" * 55)
    print(f"Total References : {total}")
    print(f"Page Hits        : {hits}")
    print(f"Page Faults      : {faults}")
    print(f"Hit Rate         : {hits / total * 100:.2f}%")
    print(f"Fault Rate       : {faults / total * 100:.2f}%")


def main():
    print("PAGE REPLACEMENT ALGORITHM SIMULATOR")
    print("-" * 55)

    # Example reference string (edit as needed, or take user input below)
    default_pages = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1]
    default_capacity = 3

    use_custom = input("Enter custom reference string? (y/n): ").strip().lower()

    if use_custom == "y":
        raw = input("Enter page reference string (space separated, e.g. 7 0 1 2 0 3): ")
        pages = [int(x) for x in raw.split()]
        capacity = int(input("Enter number of frames: "))
    else:
        pages = default_pages
        capacity = default_capacity
        print(f"Using default reference string: {pages}")
        print(f"Using default frame capacity  : {capacity}")

    results = {}

    for name, func in [("FIFO", fifo), ("LRU", lru), ("Optimal", optimal)]:
        faults, hits, history = func(pages, capacity)
        print_report(name, pages, capacity, faults, hits, history)
        results[name] = faults

    print(f"\n{'=' * 55}")
    print("SUMMARY (fewer faults = better)")
    print(f"{'=' * 55}")
    for name, faults in results.items():
        print(f"{name:<10}: {faults} page faults")

    best = min(results, key=results.get)
    print(f"\nBest performing algorithm for this input: {best}")


if __name__ == "__main__":
    main()