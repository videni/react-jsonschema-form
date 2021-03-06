import React, { Component } from "react";
import PropTypes from "prop-types";
import _pick from "lodash/pick";
import _merge from "lodash/merge";
import _cloneDeep from "lodash/cloneDeep";
import _has from "lodash/has";
import _get from "lodash/get";
import set from "set-value";

import { default as DefaultErrorList } from "./ErrorList";
import {
  getDefaultFormState,
  retrieveSchema,
  shouldRender,
  toIdSchema,
  getDefaultRegistry,
  deepEquals,
  toPathSchema,
  isObject,
} from "../utils";
import validateFormData, { toErrorList } from "../validate";
import { mergeObjects } from "../utils";

export default class Form extends Component {
  static defaultProps = {
    uiSchema: {},
    noValidate: false,
    liveValidate: false,
    disabled: false,
    noHtml5Validate: false,
    ErrorList: DefaultErrorList,
    omitExtraData: false,
  };

  constructor(props) {
    super(props);

    this.state = {
      ...Form.getStateFromProps(props, props.formData),
      errors: [],
      errorSchema: {},
      edit: typeof props.formData !== "undefined"
    };
   
    this.formElement = null;
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    return Form.getStateFromProps(nextProps, prevState.formData);
  }

  synchroize() {
    if (
      !deepEquals(this.state.formData, this.props.formData) &&
      this.props.onChange
    ) {
      const edit = typeof this.props.formData !== "undefined";
      const liveValidate = this.props.liveValidate || this.props.liveValidate;
      const mustValidate = edit && !this.props.noValidate && liveValidate;
  
      const viewData = this.tranformViewData(this.state.formData);

      let { errors, errorSchema } = mustValidate
      ? this.validate(viewData, this.props.schema, this.props.additionalMetaSchemas, this.props.customFormats)
      : {
          errors: this.state.errors || [],
          errorSchema: this.state.errorSchema || {},
        };
      if (this.props.extraErrors) {
        errorSchema = mergeObjects(errorSchema, this.props.extraErrors);
        errors = toErrorList(errorSchema);
      }
  
      this.setState({
        edit,
        errors,
        errorSchema,
      });
      
      this.props.onChange(this.state);
    }
  }

  componentDidMount() {
    this.synchroize();
  }

  componentDidUpdate() {
    this.synchroize();
  }

  static getStateFromProps(props, inputFormData) {
    const schema = props.schema;
    const uiSchema = props.uiSchema;
    const rootSchema = schema;
    const formData = getDefaultFormState(schema, inputFormData, rootSchema);
    const retrievedSchema = retrieveSchema(schema, rootSchema, formData);
    const additionalMetaSchemas = props.additionalMetaSchemas;
   
    const idSchema = toIdSchema(
      retrievedSchema,
      uiSchema["ui:rootFieldId"],
      rootSchema,
      formData,
      props.idPrefix
    );

    return {
      schema,
      uiSchema,
      idSchema,
      formData,
      additionalMetaSchemas,
    };
  }

  shouldComponentUpdate(nextProps, nextState) {
    return shouldRender(this, nextProps, nextState);
  }

  validate(
    formData,
    schema = this.props.schema,
    additionalMetaSchemas = this.props.additionalMetaSchemas,
    customFormats = this.props.customFormats
  ) {
    const { validate, transformErrors } = this.props;
    const { rootSchema } = this.getRegistry();
    const resolvedSchema = retrieveSchema(schema, rootSchema, formData);
    return validateFormData(
      formData,
      resolvedSchema,
      validate,
      transformErrors,
      additionalMetaSchemas,
      customFormats
    );
  }

  renderErrors() {
    const { errors, errorSchema, schema, uiSchema } = this.state;
    const { ErrorList, showErrorList, formContext } = this.props;

    if (errors.length && showErrorList != false) {
      return (
        <ErrorList
          errors={errors}
          errorSchema={errorSchema}
          schema={schema}
          uiSchema={uiSchema}
          formContext={formContext}
        />
      );
    }
    return null;
  }

  getUsedFormData = (formData, fields) => {
    //for the case of a single input form
    if (fields.length === 0 && typeof formData !== "object") {
      return formData;
    }

    let data = _pick(formData, fields);
    if (Array.isArray(formData)) {
      return Object.keys(data).map(key => data[key]);
    }

    return data;
  };

  getFieldNames = pathSchema => {
    const getAllPaths = (_obj, acc = [], paths = [""]) => {
      Object.keys(_obj).forEach(key => {
        if (typeof _obj[key] === "object") {
          let newPaths = paths.map(path => `${path}.${key}`);
          getAllPaths(_obj[key], acc, newPaths);
        } else if (key === "$name" && _obj[key] !== "") {
          paths.forEach(path => {
            path = path.replace(/^\./, "");
            if (!_obj["$hasChildren"]) {
              acc.push(path);
            }
          });
        }
      });
      return acc;
    };

    return getAllPaths(pathSchema);
  };

  tranformViewData = formData => {
    const { viewTransformer = {} } = this.state;
    const newFormData = _cloneDeep(formData);

    const transform = (transformers, paths = []) => {
      Object.keys(transformers).forEach(key => {
        const newPaths = paths.slice();
        newPaths.push(key);
        if (typeof transformers[key] === "object") {
          transform(transformers[key], newPaths);
        } else if (typeof transformers[key] === "function") {
          if (_has(newFormData, newPaths)) {
            const transformer = transformers[key];
            const orginalFormData = _get(formData, newPaths);
            const viewData = transformer(orginalFormData);

            set(newFormData, newPaths, viewData);
          }
        }
      });
    };

    transform(viewTransformer);

    return newFormData;
  };

  onChange = (formData, newErrorSchema) => {
    let state = {};
    if (isObject(formData) || Array.isArray(formData)) {
      const newState = Form.getStateFromProps(this.props, formData);
      formData = newState.formData;

      state = {
        formData,
        pathSchema: newState.pathSchema,
      };
    }
    const mustValidate = !this.props.noValidate && this.props.liveValidate;
    let newFormData = formData;

    if (this.props.omitExtraData === true && this.props.liveOmit === true) {
      const retrievedSchema = retrieveSchema(
        this.state.schema,
        this.state.schema,
        formData
      );
      const pathSchema = toPathSchema(
        retrievedSchema,
        "",
        this.state.schema,
        formData
      );

      const fieldNames = this.getFieldNames(pathSchema);

      newFormData = this.getUsedFormData(formData, fieldNames);
      state = {
        pathSchema,
        formData: newFormData,
      };
    }

    const viewData = this.tranformViewData(newFormData);

    if (mustValidate) {
      let { errors, errorSchema } = this.validate(viewData);
      if (this.props.extraErrors) {
        errorSchema = mergeObjects(errorSchema, this.props.extraErrors);
        errors = toErrorList(errorSchema);
      }
      state = { formData: newFormData, errors, errorSchema };
    } else if (!this.props.noValidate && newErrorSchema) {
      const errorSchema = this.props.extraErrors
        ? mergeObjects(newErrorSchema, this.props.extraErrors)
        : newErrorSchema;
      state = {
        formData: newFormData,
        errorSchema: errorSchema,
        errors: toErrorList(errorSchema),
      };
    }
    this.setState(
      state,
      () => this.props.onChange && this.props.onChange(state)
    );
  };

  addViewTransformer = transformer => {
    this.setState(state => {
      const { viewTransformer = {} } = state;

      return { viewTransformer: _merge(viewTransformer, transformer) };
    });
  };

  onBlur = (...args) => {
    if (this.props.onBlur) {
      this.props.onBlur(...args);
    }
  };

  onFocus = (...args) => {
    if (this.props.onFocus) {
      this.props.onFocus(...args);
    }
  };

  onSubmit = event => {
    event.preventDefault();
    if (event.target !== event.currentTarget) {
      return;
    }

    event.persist();
    let newFormData = this.state.formData;

    if (this.props.omitExtraData === true) {
      const retrievedSchema = retrieveSchema(
        this.state.schema,
        this.state.schema,
        newFormData
      );
      const pathSchema = toPathSchema(
        retrievedSchema,
        "",
        this.state.schema,
        newFormData
      );

      const fieldNames = this.getFieldNames(pathSchema);

      newFormData = this.getUsedFormData(newFormData, fieldNames);
    }

    const viewData = this.tranformViewData(newFormData);

    if (!this.props.noValidate) {
      let { errors, errorSchema } = this.validate(viewData);
      if (Object.keys(errors).length > 0) {
        if (this.props.extraErrors) {
          errorSchema = mergeObjects(errorSchema, this.props.extraErrors);
          errors = toErrorList(errorSchema);
        }
        this.setState({ errors, errorSchema }, () => {
          if (this.props.onError) {
            this.props.onError(errors);
          } else {
            console.error("Form validation failed", errors);
          }
        });
        return;
      }
    }

    let errorSchema;
    let errors;
    if (this.props.extraErrors) {
      errorSchema = this.props.extraErrors;
      errors = toErrorList(errorSchema);
    } else {
      errorSchema = {};
      errors = [];
    }

    this.setState(
      { formData: newFormData, errors: errors, errorSchema: errorSchema },
      () => {
        if (this.props.onSubmit) {
          this.props.onSubmit(
            {
              ...this.state,
              formData: viewData,
              status: "submitted",
            },
            event
          );
        }
      }
    );
  };

  getRegistry() {
    // For BC, accept passed SchemaField and TitleField props and pass them to
    // the "fields" registry one.
    const { fields, widgets } = getDefaultRegistry();
    return {
      fields: { ...fields, ...this.props.fields },
      widgets: { ...widgets, ...this.props.widgets },
      ArrayFieldTemplate: this.props.ArrayFieldTemplate,
      ObjectFieldTemplate: this.props.ObjectFieldTemplate,
      FieldTemplate: this.props.FieldTemplate,
      definitions: this.props.schema.definitions || {},
      rootSchema: this.props.schema,
      formContext: this.props.formContext || {},
    };
  }

  submit() {
    if (this.formElement) {
      this.formElement.dispatchEvent(
        new CustomEvent("submit", {
          cancelable: true,
        })
      );
    }
  }

  render() {
    const {
      children,
      id,
      idPrefix,
      className,
      tagName,
      name,
      method,
      target,
      action,
      autocomplete: deprecatedAutocomplete,
      autoComplete: currentAutoComplete,
      enctype,
      acceptcharset,
      noHtml5Validate,
      disabled,
      formContext,
    } = this.props;

    const { schema, uiSchema, formData, errorSchema, idSchema } = this.state;
    const registry = this.getRegistry();
    const _SchemaField = registry.fields.SchemaField;
    const FormTag = tagName ? tagName : "form";
    if (deprecatedAutocomplete) {
      console.warn(
        "Using autocomplete property of Form is deprecated, use autoComplete instead."
      );
    }
    const autoComplete = currentAutoComplete
      ? currentAutoComplete
      : deprecatedAutocomplete;

    return (
      <FormTag
        className={className ? className : "rjsf"}
        id={id}
        name={name}
        method={method}
        target={target}
        action={action}
        autoComplete={autoComplete}
        encType={enctype}
        acceptCharset={acceptcharset}
        noValidate={noHtml5Validate}
        onSubmit={this.onSubmit}
        ref={form => {
          this.formElement = form;
        }}>
        {this.renderErrors()}
        <_SchemaField
          schema={schema}
          uiSchema={uiSchema}
          errorSchema={errorSchema}
          idSchema={idSchema}
          idPrefix={idPrefix}
          formContext={formContext}
          formData={formData}
          onChange={this.onChange}
          addViewTransformer={this.addViewTransformer}
          onBlur={this.onBlur}
          onFocus={this.onFocus}
          registry={registry}
          disabled={disabled}
        />
        {children ? (
          children
        ) : (
          <div>
            <button type="submit" className="btn btn-info">
              Submit
            </button>
          </div>
        )}
      </FormTag>
    );
  }
}

if (process.env.NODE_ENV !== "production") {
  Form.propTypes = {
    schema: PropTypes.object.isRequired,
    uiSchema: PropTypes.object,
    formData: PropTypes.any,
    widgets: PropTypes.objectOf(
      PropTypes.oneOfType([PropTypes.func, PropTypes.object])
    ),
    fields: PropTypes.objectOf(PropTypes.elementType),
    ArrayFieldTemplate: PropTypes.elementType,
    ObjectFieldTemplate: PropTypes.elementType,
    FieldTemplate: PropTypes.elementType,
    ErrorList: PropTypes.func,
    onChange: PropTypes.func,
    onError: PropTypes.func,
    showErrorList: PropTypes.bool,
    onSubmit: PropTypes.func,
    id: PropTypes.string,
    className: PropTypes.string,
    tagName: PropTypes.elementType,
    name: PropTypes.string,
    method: PropTypes.string,
    target: PropTypes.string,
    action: PropTypes.string,
    autocomplete: PropTypes.string,
    enctype: PropTypes.string,
    acceptcharset: PropTypes.string,
    noValidate: PropTypes.bool,
    noHtml5Validate: PropTypes.bool,
    liveValidate: PropTypes.bool,
    validate: PropTypes.func,
    transformErrors: PropTypes.func,
    formContext: PropTypes.object,
    customFormats: PropTypes.object,
    additionalMetaSchemas: PropTypes.arrayOf(PropTypes.object),
    omitExtraData: PropTypes.bool,
    extraErrors: PropTypes.object,
  };
}
