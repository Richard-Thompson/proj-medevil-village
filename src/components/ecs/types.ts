"use client";

import { Facet } from "@react-ecs/core";
import { isObservableObject, makeObservable } from "mobx";

class SafeFacet<T extends object> extends Facet<T> {
  componentDidMount(): void {
    if (this.context) {
      Object.assign(this, this.props);
      const fake = this.createFake();
      const annotations = this.getAnnotations(fake);
      if (!isObservableObject(this)) {
        makeObservable(this, annotations, { autoBind: true });
      }
      this.context.add(this);
    } else {
      console.error("Data Component without Entity Context!");
    }
  }
}

export class Spin extends SafeFacet<Spin> {
  speed = 0.8;
}

export class Bob extends SafeFacet<Bob> {
  amplitude = 0.2;
  frequency = 1.6;
  offset = 0;
}

export class InstancedMesh extends SafeFacet<InstancedMesh> {
  binUrl = "";
  textureUrl = "/baked-textures/diffuse.webp";
}
