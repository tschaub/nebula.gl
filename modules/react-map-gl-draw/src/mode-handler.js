// @flow
import { _MapContext as MapContext } from 'react-map-gl';
import React, { PureComponent } from 'react';
import {
  ImmutableFeatureCollection,
  ViewMode,
  TranslateMode,
  DrawPointMode,
  DrawLineStringMode,
  DrawRectangleMode,
  DrawPolygonMode
} from '@nebula.gl/edit-modes';

import type {
  Feature,
  FeatureCollection,
  ModeProps,
  Position,
  EditAction
} from '@nebula.gl/edit-modes';
import type { MjolnirEvent } from 'mjolnir.js';
import type { BaseEvent, EditorProps, EditorState, SelectAction } from './types';
import memoize from './memoize';

import { DRAWING_MODE, ELEMENT_TYPE, MODES } from './constants';
import { getScreenCoords, isNumeric, parseEventElement } from './edit-modes/utils';

const MODE_NAME_MAPPING = Object.freeze({
  [MODES.READ_ONLY]: ViewMode,
  [MODES.SELECT]: ViewMode,
  [MODES.EDITING]: TranslateMode,
  [MODES.DRAW_POINT]: DrawPointMode,
  [MODES.DRAW_PATH]: DrawLineStringMode,
  [MODES.DRAW_RECTANGLE]: DrawRectangleMode,
  [MODES.DRAW_POLYGON]: DrawPolygonMode
});

const defaultProps = {
  mode: ViewMode,
  features: null,
  onSelect: null,
  onUpdate: null
};

const defaultState = {
  featureCollection: new ImmutableFeatureCollection({
    type: 'FeatureCollection',
    features: []
  }),

  selectedFeatureIndex: null,

  // index, isGuide, mapCoords, screenCoords
  hovered: null,

  isDragging: false,
  didDrag: false,

  lastPointerMoveEvent: null,

  pointerDownPicks: null,
  pointerDownScreenCoords: null,
  pointerDownMapCoords: null
};

export default class ModeHandler extends PureComponent<EditorProps, EditorState> {
  static defaultProps = defaultProps;

  constructor() {
    super();
    this.state = defaultState;
    this._eventsRegistered = false;

    this._events = {
      anyclick: evt => this._onEvent(this._onClick, evt, true),
      click: evt => evt.stopImmediatePropagation(),
      pointermove: evt => this._onEvent(this._onPointerMove, evt, true),
      pointerdown: evt => this._onEvent(this._onPointerDown, evt, true),
      pointerup: evt => this._onEvent(this._onPointerUp, evt, true),
      panmove: evt => this._onEvent(this._onPan, evt, false),
      panstart: evt => this._onEvent(this._onPan, evt, false),
      panend: evt => this._onEvent(this._onPan, evt, false)
    };
  }

  componentDidMount() {
    this._setupModeInstance();
  }

  componentDidUpdate(prevProps: EditorProps) {
    if (prevProps.mode !== this.props.mode) {
      this._clearEditingState();
      this._setupModeInstance();
    }
  }

  componentWillUnmount() {
    this._degregisterEvents();
  }

  _events: any;
  _eventsRegistered: boolean;
  _modeInstance: any;
  _context: ?MapContext;
  _containerRef: ?HTMLElement;

  getFeatures = () => {
    let featureCollection = this._getImmutableFeatureCollection();
    featureCollection = featureCollection && featureCollection.getObject();
    return featureCollection && featureCollection.features;
  };

  addFeatures = (features: Feature | Feature[]) => {
    let featureCollection = this._getImmutableFeatureCollection();
    if (featureCollection) {
      if (!Array.isArray(features)) {
        features = [features];
      }

      featureCollection = featureCollection.addFeatures(features);
      this.setState({ featureCollection });
    }
  };

  deleteFeatures = (featureIndexes: number | number[]) => {
    let featureCollection = this._getImmutableFeatureCollection();
    const selectedFeatureIndex = this._getSelectedFeatureIndex();
    if (featureCollection) {
      if (!Array.isArray(featureIndexes)) {
        featureIndexes = [featureIndexes];
      }
      featureCollection = featureCollection.deleteFeatures(featureIndexes);
      const newState: any = { featureCollection };
      if (featureIndexes.findIndex(index => selectedFeatureIndex === index) >= 0) {
        newState.selectedFeatureIndex = null;
      }
      this.setState(newState);
    }
  };

  getModeProps(): ModeProps<FeatureCollection> {
    const { modeConfig } = this.props;
    const featureCollection = this._getImmutableFeatureCollection();

    const { lastPointerMoveEvent } = this.state;
    const selectedFeatureIndex = this._getSelectedFeatureIndex();
    const viewport = this._context && this._context.viewport;

    return {
      data: featureCollection.getObject(),
      // data: featureCollection,
      modeConfig,
      selectedIndexes: [selectedFeatureIndex],

      lastPointerMoveEvent,
      viewport,
      onEdit: this._onEdit,

      // TODO: handle changing cursor
      cursor: null,
      onUpdateCursor: (cursor: ?string) => {}
    };
  }

  /* MEMORIZERS */
  _getMemorizedFeatureCollection = memoize(({ propsFeatures, stateFeatures }: any) => {
    const features = propsFeatures || stateFeatures;
    // Any changes in ImmutableFeatureCollection will create a new object
    if (features instanceof ImmutableFeatureCollection) {
      return features;
    }

    if (features && features.type === 'FeatureCollection') {
      return new ImmutableFeatureCollection({
        type: 'FeatureCollection',
        features: features.features
      });
    }

    return new ImmutableFeatureCollection({
      type: 'FeatureCollection',
      features: features || []
    });
  });

  _getImmutableFeatureCollection = () => {
    return this._getMemorizedFeatureCollection({
      propsFeatures: this.props.features,
      stateFeatures: this.state.featureCollection
    });
  };

  _setupModeInstance = () => {
    const { mode } = this.props;

    if (!mode) {
      this._degregisterEvents();
      this._modeInstance = null;
      return;
    }

    this._registerEvents();

    if (typeof mode === 'function') {
      const ModeConstructor = mode;
      this._modeInstance = new ModeConstructor();
    } else if (typeof mode === 'string') {
      this._modeInstance = new MODE_NAME_MAPPING[mode]();
    } else {
      this._modeInstance = null;
    }
  };

  /* EDITING OPERATIONS */
  _clearEditingState = () => {
    this.setState({
      selectedFeatureIndex: null,

      hovered: null,

      pointerDownPicks: null,
      pointerDownScreenCoords: null,
      pointerDownMapCoords: null,

      isDragging: false,
      didDrag: false
    });
  };

  _getSelectedFeatureIndex = () => {
    if ('selectedFeatureIndex' in this.props) {
      return this.props.selectedFeatureIndex;
    }
    return this.state.selectedFeatureIndex;
  };

  _getSelectedFeature = (featureIndex: ?number) => {
    const features = this.getFeatures();
    featureIndex = isNumeric(featureIndex) ? featureIndex : this._getSelectedFeatureIndex();
    return features[featureIndex];
  };

  _onSelect = (selected: SelectAction) => {
    this.setState({ selectedFeatureIndex: selected && selected.selectedFeatureIndex });
    if (this.props.onSelect) {
      this.props.onSelect(selected);
    }
  };

  _onUpdate = (editAction: EditAction, isInternal: ?boolean) => {
    const { editType, updatedData, editContext } = editAction;
    this.setState({ featureCollection: new ImmutableFeatureCollection(updatedData) });
    if (this.props.onUpdate && !isInternal) {
      this.props.onUpdate({
        data: updatedData && updatedData.features,
        editType,
        editContext
      });
    }
  };

  _onEdit = (editAction: EditAction<FeatureCollection>) => {
    if (this.props.onEdit) {
      this.props.onEdit(editAction);
    }

    if (!this.props.features) {
      // Also update internal state of features if features aren't controlled
      this.setState({ featureCollection: new ImmutableFeatureCollection(editAction.updatedData) });
    }
  };

  /* EVENTS */
  _degregisterEvents = () => {
    const eventManager = this._context && this._context.eventManager;
    if (!this._events || !eventManager) {
      return;
    }

    if (this._eventsRegistered) {
      eventManager.off(this._events);
      this._eventsRegistered = false;
    }
  };

  _registerEvents = () => {
    const ref = this._containerRef;
    const eventManager = this._context && this._context.eventManager;
    if (!this._events || !ref || !eventManager) {
      return;
    }

    if (this._eventsRegistered) {
      return;
    }

    eventManager.on(this._events, ref);
    this._eventsRegistered = true;
  };

  _onEvent = (handler: Function, evt: MjolnirEvent, stopPropagation: boolean) => {
    const event = this._getEvent(evt);
    handler(event);

    if (stopPropagation) {
      evt.stopImmediatePropagation();
    }
  };

  _onClick = (event: BaseEvent) => {
    const { mode } = this.props;
    if (mode === MODES.SELECT || mode === MODES.EDITING) {
      const { mapCoords, screenCoords } = event;
      const pickedObject = event.picks && event.picks[0] && event.picks[0].object;
      if (pickedObject && isNumeric(pickedObject.featureIndex)) {
        const selectedFeatureIndex = pickedObject.featureIndex;
        const selectedFeature = this._getSelectedFeature(selectedFeatureIndex);
        this._onSelect({
          selectedFeature,
          selectedFeatureIndex,
          selectedEditHandleIndex:
            pickedObject.type === ELEMENT_TYPE.EDIT_HANDLE ? pickedObject.index : null,
          mapCoords,
          screenCoords
        });
      } else {
        this._onSelect({
          selectedFeature: null,
          selectedFeatureIndex: null,
          selectedEditHandleIndex: null,
          mapCoords,
          screenCoords
        });
      }
    }

    const modeProps = this.getModeProps();
    this._modeInstance.handleClick(event, modeProps);
  };

  _onPointerMove = (event: BaseEvent) => {
    // hovering
    const hovered = this._getHoverState(event);
    const {
      isDragging,
      didDrag,
      pointerDownPicks,
      pointerDownScreenCoords,
      pointerDownMapCoords
    } = this.state;

    if (isDragging && !didDrag && pointerDownScreenCoords) {
      const dx = event.screenCoords[0] - pointerDownScreenCoords[0];
      const dy = event.screenCoords[1] - pointerDownScreenCoords[1];
      if (dx * dx + dy * dy > 5) {
        this.setState({ didDrag: true });
      }
    }

    const pointerMoveEvent = {
      ...event,
      isDragging,
      pointerDownPicks,
      pointerDownScreenCoords,
      pointerDownMapCoords
    };

    if (this.state.didDrag) {
      const modeProps = this.getModeProps();
      this._modeInstance.handlePointerMove(pointerMoveEvent, modeProps);
    }

    this.setState({
      hovered,
      lastPointerMoveEvent: pointerMoveEvent
    });
  };

  _onPointerDown = (event: BaseEvent) => {
    const pickedObject = event.picks && event.picks[0] && event.picks[0].object;
    const startDraggingEvent = {
      ...event,
      pointerDownScreenCoords: event.screenCoords,
      pointerDownMapCoords: event.mapCoords
    };

    const newState = {
      isDragging: pickedObject && isNumeric(pickedObject.featureIndex),
      pointerDownPicks: event.picks,
      pointerDownScreenCoords: event.screenCoords,
      pointerDownMapCoords: event.mapCoords
    };

    this.setState(newState);

    const modeProps = this.getModeProps();
    this._modeInstance.handleStartDragging(startDraggingEvent, modeProps);
  };

  _onPointerUp = (event: MjolnirEvent) => {
    const stopDraggingEvent = {
      ...event,
      pointerDownScreenCoords: this.state.pointerDownScreenCoords,
      pointerDownMapCoords: this.state.pointerDownMapCoords
    };

    const newState = {
      isDragging: false,
      didDrag: false,
      pointerDownPicks: null,
      pointerDownScreenCoords: null,
      pointerDownMapCoords: null
    };

    this.setState(newState);

    const modeProps = this.getModeProps();
    this._modeInstance.handleStopDragging(stopDraggingEvent, modeProps);
  };

  _onPan = (event: BaseEvent) => {
    const { isDragging } = this.state;
    if (isDragging) {
      event.sourceEvent.stopImmediatePropagation();
    }
  };

  /* HELPERS */
  project = (pt: Position) => {
    const viewport = this._context && this._context.viewport;
    return viewport && viewport.project(pt);
  };

  unproject = (pt: Position) => {
    const viewport = this._context && this._context.viewport;
    return viewport && viewport.unproject(pt);
  };

  _getEvent(evt: MjolnirEvent) {
    const picked = parseEventElement(evt);
    const screenCoords = getScreenCoords(evt);
    const mapCoords = this.unproject(screenCoords);

    return {
      picks: picked ? [picked] : null,
      screenCoords,
      mapCoords,
      sourceEvent: evt
    };
  }

  _getHoverState = (event: BaseEvent) => {
    const object = event.picks && event.picks[0] && event.picks[0].object;
    if (!object) {
      return null;
    }

    return {
      screenCoords: event.screenCoords,
      mapCoords: event.mapCoords,
      ...object
    };
  };

  _isDrawing() {
    const { mode } = this.props;
    return DRAWING_MODE.findIndex(m => m === mode) >= 0;
  }

  _render() {
    return <div />;
  }

  render() {
    return (
      <MapContext.Consumer>
        {context => {
          this._context = context;
          const viewport = context && context.viewport;

          if (!viewport || viewport.height <= 0 || viewport.width <= 0) {
            return null;
          }

          return this._render();
        }}
      </MapContext.Consumer>
    );
  }
}

ModeHandler.displayName = 'ModeHandler';
