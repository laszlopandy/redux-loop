import * as Redux from 'redux';
import * as Errors from './errors';

if (typeof Promise === 'undefined') {
  throw new Error(Errors.promisePolyfill);
}

export interface Loop<State, Action> {
  state: State,
  effects: Effect<Action>[],
}

export type Reducer<State> = <Action extends Redux.Action>(state: State, action: Action) => Loop<State, Action>;

export interface Store<S> {
  getState: () => S,
  subscribe: (fn: Function) => void,
  replaceReducer: (reducer: Reducer<S>) => void,
  dispatch: (action: Redux.Action) => any,
}

export function createLoopStore<S, A extends Redux.Action>(reducer: Reducer<S>, initialModel: Loop<S, A>, enhancer?: Redux.StoreEnhancer<S>): Store<S> {
  return (function () {
    let queue = [] as Effect<A>[];

    function liftReducer(reducer: Reducer<S>): Redux.Reducer<S> {
      return (state: S, action: A): S => {
        const ret = reducer(state, action)

        ret.effects.forEach(effect => queue.push(effect))

        return ret.state
      }
    }

    const store = Redux.createStore(
      liftReducer(reducer),
      initialModel.state,
      enhancer,
    )

    function executeEffects(callback: (action: A) => void, effects: Effect<A>[]): Promise<any>[] {
      return effects.map(effect =>
        effect
          .toPromise()
          .then(callback)
          .catch((err: Error) => {
            console.error(err);
            throw new Error(Errors.loopPromiseCaughtError);
          })
      );
    }

    function enhancedDispatch(action: A): Promise<any> {
      store.dispatch(action)

      const currentQueue = queue;
      queue = []

      return Promise.all(
        executeEffects(enhancedDispatch, currentQueue)
      );
    }

    executeEffects(enhancedDispatch, initialModel.effects)

    const enhancedReplaceReducer = (reducer: Reducer<S>) => {
      return store.replaceReducer(liftReducer(reducer));
    };

    return {
      getState: store.getState,
      subscribe: store.subscribe,
      dispatch: enhancedDispatch,
      replaceReducer: enhancedReplaceReducer,
    };
  })();
}

export interface Effect<A> {
  map<T>(fn: (action: A) => T): Effect<T>
  toPromise(): Promise<A>
}

export function effect<A>(promiseCreator: () => Promise<A>): Effect<A> {
  return new DefaultEffectImpl(promiseCreator)
}

class DefaultEffectImpl<A> implements Effect<A> {
  private readonly _promiseCreator: () => Promise<A>;

  constructor(readonly promiseCreator: () => Promise<A>) {
    this._promiseCreator = promiseCreator;
  }

  map = <T>(fn: (action: A) => T): Effect<T> => {
    return new DefaultEffectImpl(() => this._promiseCreator().then(fn));
  }

  toPromise = (): Promise<A> => {
    const promise = this._promiseCreator();

    if (promise instanceof Promise) {
      return promise;
    }

    throw new Error(Errors.effectCreatorIsWrong);
  }
}
