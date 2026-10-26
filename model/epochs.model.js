/**
 * Sequelize model definition for the epochs table.
 *
 * Defines the `epochs` table, which stores per-epoch performance
 * statistics and timing information for each training run.
 *
 * Each record represents one complete epoch during training, including
 * start/end times, loss metrics, and precision/recall/mAP.
 *
 * This table supports training visualization, performance analysis, and
 * historical comparison of model training behavior as part of the MARP
 * Machine Learning Database Schema.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for epochs.
 * @author Isaac Assegai Travers
 * @module model/epochs
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the epochs Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the training_runs model
 * through {@link epochs.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized epochs model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one training epoch's performance and
   * timing data.
   *
   * Tracks the performance and timing of each training epoch. Each epoch
   * belongs to a specific training run.
   *
   * @class epochs
   * @extends Model
   */
  class epochs extends Model {
    /**
     * Register relationships between epochs and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // Each epoch belongs to one training run
      this.belongsTo(models.training_runs, {
        as: 'training_run',
        foreignKey: 'training_run_id',
      });
    }
  }

  epochs.init(
    {
      id: {
        // Primary key for the epoch record
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment: 'Unique identifier for this epoch record.',
        jsonSchema: {
            description: 'Unique identifier for this epoch record.',
            examples: [501],
        },
      },

      training_run_id: {
        // Foreign key to the parent training run
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key linking this epoch to its parent training run (training_runs.id).',
        jsonSchema: {
            description: 'Foreign key linking this epoch to its parent training run (training_runs.id).',
            examples: [12],
        },
      },

      epoch_number: {
        // Sequential number of the epoch (e.g., 1, 2, 3 ...)
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'The ordinal number of this epoch in the training sequence.',
        jsonSchema: {
            description: 'The ordinal number of this epoch in the training sequence.',
            examples: [3],
        },
      },

      // -------------------------------
      // TIMING INFORMATION
      // -------------------------------

      start_time: {
        // When the epoch started (captured by the trainer)
        type: DataTypes.DATE,
        allowNull: true,
        comment:
          'Timestamp marking when this epoch began processing.',
        jsonSchema: {
            description: 'Timestamp marking when this epoch began processing.',
        },
      },

      end_time: {
        // When the epoch finished
        type: DataTypes.DATE,
        allowNull: true,
        comment:
          'Timestamp marking when this epoch completed.',
        jsonSchema: {
            description: 'Timestamp marking when this epoch completed.',
        },
      },

      duration_seconds: {
        // Optional precomputed field for performance analysis
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Total elapsed time of this epoch, in seconds (end_time - start_time).',
        jsonSchema: {
            description: 'Total elapsed time of this epoch, in seconds (end_time - start_time).',
        },
      },

      // -------------------------------
      // PERFORMANCE METRICS
      // -------------------------------

      precision: {
        // Model precision for this epoch — fraction of true positives among predicted positives
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Precision metric value recorded at the end of this epoch.',
        jsonSchema: {
            description: 'Precision metric value recorded at the end of this epoch.',
        },
      },

      recall: {
        // Model recall for this epoch — fraction of true positives among all actual positives
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Recall metric value recorded at the end of this epoch.',
        jsonSchema: {
            description: 'Recall metric value recorded at the end of this epoch.',
        },
      },

      map50: {
        // Mean Average Precision at IoU threshold 0.5
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean Average Precision (mAP) at 0.5 IoU threshold for this epoch.',
        jsonSchema: {
            description: 'Mean Average Precision (mAP) at 0.5 IoU threshold for this epoch.',
        },
      },

      map5095: {
        // Mean Average Precision averaged across IoU thresholds 0.5:0.95
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean Average Precision (mAP) averaged across IoU thresholds 0.5–0.95 for this epoch.',
        jsonSchema: {
            description: 'Mean Average Precision (mAP) averaged across IoU thresholds 0.5–0.95 for this epoch.',
        },
      },

      // -------------------------------
      // LOSS METRICS
      // -------------------------------

      box_loss: {
        // Bounding box regression loss
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Loss associated with bounding box coordinate regression during this epoch.',
        jsonSchema: {
            description: 'Loss associated with bounding box coordinate regression during this epoch.',
        },
      },

      cls_loss: {
        // Classification loss
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Loss associated with class label predictions during this epoch.',
        jsonSchema: {
            description: 'Loss associated with class label predictions during this epoch.',
        },
      },

      dfl_loss: {
        // Distribution Focal Loss (YOLOv8 and related architectures)
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Distribution Focal Loss (DFL) for this epoch, if applicable to the model type.',
        jsonSchema: {
            description: 'Distribution Focal Loss (DFL) for this epoch, if applicable to the model type.',
        },
      },

      // -------------------------------
      // TRAINING LOSSES
      //
      // The three above are the VALIDATION losses, which is what the worker has always
      // sent. Ultralytics reports the training losses as a separate series, and the gap
      // between the two is the overfitting signal -- the first thing an ML reader looks
      // for. Neither set is allowed to stand in for the other: one column meaning
      // training loss on some rows and validation loss on others could not be read at all.
      // -------------------------------

      train_box_loss: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean training box loss over this epoch, against the validation loss in box_loss.',
        jsonSchema: {
            description: 'Mean training box loss over this epoch. The box_loss column beside '
                + 'it is the validation loss; the gap between the two is the overfitting signal.',
        },
      },

      train_cls_loss: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean training classification loss over this epoch.',
        jsonSchema: {
            description: 'Mean training classification loss over this epoch. Null means not '
                + 'reported -- the trainer has none through a NaN-recovery epoch -- never zero.',
        },
      },

      train_dfl_loss: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean training distribution-focal loss over this epoch.',
        jsonSchema: {
            description: 'Mean training distribution-focal loss over this epoch. A genuine 0.0 '
                + 'is stored as 0.0; an absent reading is null.',
        },
      },

      // -------------------------------
      // WHERE THE EPOCH SAT IN THE RUN
      //
      // Elapsed seconds since training began, not instants: "ordering and duration only
      // -- valid within a run, never compared across machines." The origin is set after
      // setup has built the dataloaders and the optimizer, so epoch 1 sits at roughly
      // 0.000 however long setup took. start_time and end_time are timestamps, stay null,
      // and keep meaning what their type says.
      // -------------------------------

      start_offset_s: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Seconds from the start of training to the start of this epoch.',
        jsonSchema: {
            description: 'Seconds from the start of training to the start of this epoch. '
                + 'Elapsed time measured by the trainer, not an instant, and not a position '
                + 'on any MARP-wide timeline.',
        },
      },

      end_offset_s: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Seconds from the start of training to the end of this epoch.',
        jsonSchema: {
            description: 'Seconds from the start of training to the end of this epoch. Its '
                + 'difference from start_offset_s is duration_seconds, exactly in the trainer '
                + 'that computed all three.',
        },
      },

      timestamp: {
        // Optional: record when this epoch was logged
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this epoch record was inserted into the database.',
        jsonSchema: {
            description: 'Timestamp when this epoch record was inserted into the database.',
        },
      },

      created_at: {
        // Record creation timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this epoch record was created.',
        jsonSchema: {
            description: 'Timestamp when this epoch record was created.',
        },
      },

      updated_at: {
        // Record update timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this epoch record was last updated.',
        jsonSchema: {
            description: 'Timestamp when this epoch record was last updated.',
        },
      },
    },
    {
      sequelize,                        // shared Sequelize connection instance
      modelName: 'epochs',              // used inside Sequelize
      tableName: 'epochs',              // actual PostgreSQL table
      schema: 'public',                 // database schema containing the table
      timestamps: false,                // we manage created_at/updated_at manually
      comment:
        'Stores per-epoch performance and timing metrics for each training run in the MARP ML system.',
      indexes: [
        {
          name: 'epochs_pkey',                     // primary key index
          unique: true,
          fields: ['id'],
        },
        {
          name: 'epochs_training_run_id_idx',      // speeds up lookups by training run
          fields: ['training_run_id'],
        },
        {
          name: 'epochs_epoch_number_idx',         // speeds up ordering/lookups by epoch number
          fields: ['epoch_number'],
        },
        {
          name: 'epochs_start_time_idx',           // speeds up chronological queries
          fields: ['start_time'],
        },
      ],
    }
  );

  return epochs;
};