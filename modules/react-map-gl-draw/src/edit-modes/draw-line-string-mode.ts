import uuid from 'uuid/v1';

import { ClickEvent, FeatureCollection } from '@nebula.gl/edit-modes';
import { ModeProps } from '../types';

import { EDIT_TYPE, GEOJSON_TYPE, GUIDE_TYPE, RENDER_TYPE } from '../constants';
import BaseMode from './base-mode';
import { getFeatureCoordinates } from './utils';

export default class DrawLineStringMode extends BaseMode {
  handleClick = (event: ClickEvent, props: ModeProps<FeatureCollection>) => {
    const tentativeFeature = this.getTentativeFeature();

    if (tentativeFeature) {
      // commit tentativeFeature to featureCollection
      this._updateTentativeFeature(event, props);
    } else {
      this._initTentativeFeature(event, props);
    }
  };

  handleDblClick(event: ClickEvent, props: ModeProps<FeatureCollection>) {
    this._commitTentativeFeature(event, props);
  }
  // @ts-ignore
  getGuides = (props: ModeProps<FeatureCollection>) => {
    // @ts-ignore
    const selectedFeature = this.getSelectedFeature(props);
    let tentativeFeature = this.getTentativeFeature();

    const feature = selectedFeature || tentativeFeature;
    const coordinates = getFeatureCoordinates(feature);

    if (!coordinates) {
      return null;
    }

    const event = props.lastPointerMoveEvent;

    // existing editHandles + cursorEditHandle
    // @ts-ignore
    const editHandles = this.getEditHandlesFromFeature(feature) || [];
    const cursorEditHandle = {
      type: 'Feature',
      properties: {
        guideType: GUIDE_TYPE.CURSOR_EDIT_HANDLE,
        // TODO remove renderType
        renderType: RENDER_TYPE.LINE_STRING,
        positionIndexes: [editHandles.length],
      },
      geometry: {
        type: GEOJSON_TYPE.POINT,
        coordinates: [event.mapCoords],
      },
    };
    editHandles.push(cursorEditHandle);

    // tentativeFeature
    tentativeFeature = {
      ...tentativeFeature,
      geometry: {
        type: GEOJSON_TYPE.LINE_STRING,
        // @ts-ignore
        coordinates: [...coordinates, event.mapCoords],
      },
    };

    return {
      tentativeFeature,
      editHandles,
    };
  };

  _updateTentativeFeature = (event: ClickEvent, props: ModeProps<FeatureCollection>) => {
    let tentativeFeature = this.getTentativeFeature();
    if (!tentativeFeature) {
      return;
    }
    // update tentativeFeature
    tentativeFeature = {
      ...tentativeFeature,
      geometry: {
        type: GEOJSON_TYPE.LINE_STRING,
        // @ts-ignore
        coordinates: [...tentativeFeature.geometry.coordinates, event.mapCoords],
      },
    };
    this.setTentativeFeature(tentativeFeature);

    props.onEdit({
      editType: EDIT_TYPE.ADD_POSITION,
      // @ts-ignore
      updatedData: props.data.getObject(),
      editContext: [
        {
          feature: tentativeFeature,
          featureIndex: null,
          editHandleIndex: tentativeFeature.geometry.coordinates.length - 1,
          screenCoords: event.screenCoords,
          mapCoords: event.mapCoords,
        },
      ],
    });
  };

  _commitTentativeFeature = (event: ClickEvent, props: ModeProps<FeatureCollection>) => {
    const tentativeFeature = this.getTentativeFeature();
    if (!tentativeFeature) {
      return;
    }

    const { data } = props;
    this.setTentativeFeature(null);

    const feature = {
      ...tentativeFeature,
      properties: {
        id: tentativeFeature.properties.id,
        // todo deprecate renderType
        renderType: RENDER_TYPE.LINE_STRING,
      },
    };
    // @ts-ignore
    const updatedData = data.addFeature(feature).getObject();

    props.onEdit({
      editType: EDIT_TYPE.ADD_FEATURE,
      updatedData,
      editContext: null,
    });
  };

  _initTentativeFeature = (event: ClickEvent, props: ModeProps<FeatureCollection>) => {
    this.setTentativeFeature({
      type: 'Feature',
      properties: {
        // TODO deprecate id & renderType
        id: uuid(),
        renderType: RENDER_TYPE.LINE_STRING,
        guideType: GUIDE_TYPE.TENTATIVE,
      },
      // @ts-ignore
      geometry: {
        type: GEOJSON_TYPE.POINT,
        coordinates: [event.mapCoords],
      },
    });
  };
}
