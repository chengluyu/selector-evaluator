import * as S from 'selector-parser';

export interface Operations<T> {
  getTagName(node: T): string;
  getContent(node: T): string;
  getID(node: T): string;
  hasClass(node: T, className: string): boolean;
  getParent(node: T): T | null;
  getChildren(node: T): Iterable<T>;
  getAttribute(node: T, name: string): string | null;
  getPreviouSibling(node: T): T | null;
  getNextSibling(node: T): T | null;
}

export interface Evaluator<T> {
  querySelector(root: T, selectors: string): T | null;
  querySelectorAll(root: T, selectors: string): T[];
}

export function create<T extends object>(operations: Operations<T>): Evaluator<T> {
  const collectors = {
    [S.CombinatorKind.Descendant](nodes: T[]): T[] {
      const ancestors: T[] = [];
      const deduplicator = new WeakSet();
      for (const node of nodes) {
        let t: T | null = operations.getParent(node);
        while (t) {
          if (!deduplicator.has(t)) {
            ancestors.push(t);
            deduplicator.add(t);
          }
          t = operations.getParent(t);
        }
      }
      return ancestors;
    },
    [S.CombinatorKind.Child](nodes: T[]): T[] {
      const parents: T[] = [];
      const deduplicator = new WeakSet();
      for (const node of nodes) {
        const parent = operations.getParent(node);
        if (parent) {
          if (!deduplicator.has(parent)) {
            parents.push(parent);
            deduplicator.add(parent);
          }
        }
      }
      return parents;
    },
    [S.CombinatorKind.NextSibling](nodes: T[]): T[] {
      const siblings: T[] = [];
      const deduplicator = new WeakSet();
      for (const node of nodes) {
        const sibling = operations.getPreviouSibling(node);
        if (sibling) {
          if (!deduplicator.has(sibling)) {
            siblings.push(sibling);
            deduplicator.add(sibling);
          }
        }
      }
      return siblings;
    },
    [S.CombinatorKind.SubsequentSibling](nodes: T[]): T[] {
      const siblings: T[] = [];
      const deduplicator = new WeakSet();
      for (const node of nodes) {
        let t: T | null = operations.getPreviouSibling(node);
        while (t) {
          if (!deduplicator.has(t)) {
            siblings.push(t);
            deduplicator.add(t);
          }
          t = operations.getPreviouSibling(t);
        }
      }
      return siblings;
    },
    [S.CombinatorKind.Column](): never {
      throw new Error('column combinator is not supported');
    },
  };

  // See https://drafts.csswg.org/selectors/#attribute-representation
  // TODO: Some matchers can be more efficient.
  const matchers = {
    /**
     * Represents an element with the att attribute whose value is exactly "val".
     */
    '=': (value: string, expected: string): boolean => value === expected,
    /**
     * Represents an element with the att attribute whose value is a
     * whitespace-separated list of words, one of which is exactly "val".
     * If "val" contains whitespace, it will never represent anything
     * (since the words are separated by spaces).
     * Also if "val" is the empty string, it will never represent anything.
     */
    '~=': (value: string, expected: string): boolean => value.split(/ +/).includes(expected),
    /**
     * Represents an element with the att attribute, its value either being
     * exactly "val" or beginning with "val" immediately followed by
     * "-" (U+002D).
     * This is primarily intended to allow language subcode matches
     * (e.g., the hreflang attribute on the a element in HTML) as described in
     * BCP 47 ([BCP47]) or its successor. For lang (or xml:lang) language
     * subcode matching, please see the :lang pseudo-class.
     */
    '|=': (value: string, expected: string): boolean =>
      value === expected || value.startsWith(expected + '-'),
    /**
     * Represents an element with the att attribute whose value begins with the
     * prefix "val". If "val" is the empty string then the selector does not
     * represent anything.
     */
    '^=': (value: string, expected: string): boolean => value.startsWith(expected),
    /**
     * Represents an element with the att attribute whose value ends with the
     * suffix "val". If "val" is the empty string then the selector does not
     * represent anything.
     */
    '$=': (value: string, expected: string): boolean => value.endsWith(expected),
    /**
     * Represents an element with the att attribute whose value contains at
     * least one instance of the substring "val". If "val" is the empty string
     * then the selector does not represent anything.
     */
    '*=': (value: string, expected: string): boolean => value.includes(expected),
  };

  function* preorderDepthFirstTraverse(node: T, includeRoot = false): IterableIterator<T> {
    if (includeRoot) {
      yield node;
    }
    for (const child of operations.getChildren(node)) {
      yield* preorderDepthFirstTraverse(child, true);
    }
  }

  function matchSubClassSelector(
    node: T,
    selector:
      | S.IDSelector
      | S.ClassSelector
      | S.AttributeSelector
      | S.PseudoClassSelector
      | S.PseudoElementSelector,
  ): boolean {
    switch (selector.kind) {
      case S.SelectorKind.ID:
        return operations.getID(node) === selector.value;
      case S.SelectorKind.Class:
        return operations.hasClass(node, selector.value);
      case S.SelectorKind.Attribute:
        const value = operations.getAttribute(node, selector.name);
        return selector.match === undefined
          ? typeof value === 'string'
          : value !== null && matchers[selector.match.matcher](value, selector.match.value.value);
      case S.SelectorKind.PseudoClass:
        // TODO: Implement well-known pseudo-classes.
        return true;
      case S.SelectorKind.PseudoElement:
        return false;
    }
  }

  function matchCompoundSelector(
    root: T,
    { type, subclasses, pseudoes }: S.CompoundSelector,
  ): boolean {
    if (type && operations.getTagName(root).toUpperCase() !== type.name.toUpperCase()) {
      return false;
    }
    if (subclasses) {
      for (const selector of subclasses) {
        if (!matchSubClassSelector(root, selector)) {
          return false;
        }
      }
    }
    if (pseudoes) {
      for (const selector of pseudoes) {
        if (!matchSubClassSelector(root, selector)) {
          return false;
        }
      }
    }
    return true;
  }

  function matchComplexSelector(root: T, { head, tail }: S.ComplexSelector): boolean {
    let candidates: T[] = [root];
    for (let i = tail.length - 1; i >= 0; i -= 1) {
      const [combinator, selector] = tail[i];
      candidates = candidates.filter(t => matchCompoundSelector(t, selector));
      if (candidates.length === 0) {
        return false;
      }
      candidates = collectors[combinator](candidates);
    }
    candidates = candidates.filter(t => matchCompoundSelector(t, head));
    return candidates.length > 0;
  }

  function matchSelectors(root: T, selectors: S.ComplexSelector[]): boolean {
    for (const selector of selectors) {
      if (matchComplexSelector(root, selector)) {
        return true;
      }
    }
    return false;
  }

  /**
   * See: https://dom.spec.whatwg.org/#dom-parentnode-queryselectorall
   *
   * > The `querySelector(selectors)` method, when invoked, must return the first
   * > result of running scope-match a selectors string selectors against this,
   * > if the result is not an empty list, and null otherwise.
   * @param root the root node
   * @param selectors the selectors
   */
  function querySelector(root: T, selectors: string): T | null {
    const parsedSelectors = S.parse(selectors);
    for (const node of preorderDepthFirstTraverse(root)) {
      if (matchSelectors(node, parsedSelectors)) {
        return node;
      }
    }
    return null;
  }

  /**
   * See: https://dom.spec.whatwg.org/#dom-parentnode-queryselectorall
   *
   * > The `querySelectorAll(selectors)` method, when invoked, must return the
   * > static result of running scope-match a selectors string selectors against
   * > this.
   * @param root the root node
   * @param selectors the selectors
   */
  function querySelectorAll(root: T, selectors: string): T[] {
    const parsedSelectors = S.parse(selectors);
    const matchList: T[] = [];
    for (const node of preorderDepthFirstTraverse(root)) {
      if (matchSelectors(node, parsedSelectors)) {
        matchList.push(node);
      }
    }
    return matchList;
  }

  return { querySelector, querySelectorAll };
}
