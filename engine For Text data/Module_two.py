import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.experimental import enable_iterative_imputer
from sklearn.impute import IterativeImputer, KNNImputer, SimpleImputer
from sklearn.preprocessing import OrdinalEncoder, OneHotEncoder, TargetEncoder

def FillingNaN(df, column, method, custom_fill_value="Missing"):
    """Fills NaNs in a specific column based on the chosen method."""
    df = df.copy() # Prevent mutating the original dataset accidentally
    
    if column not in df.columns or not df[column].isnull().any():
        return df

    # ==================== NUMERIC COLUMNS ====================
    if pd.api.types.is_numeric_dtype(df[column]):
        non_nulls = df[column].dropna()
        is_int = pd.api.types.is_integer_dtype(df[column]) or (len(non_nulls) > 0 and (non_nulls % 1 == 0).all())

        if method in ["mean", "median", "mode"]:
            strategy_map = {"mean": "mean", "median": "median", "mode": "most_frequent"}
            imputer = SimpleImputer(strategy=strategy_map[method])
            imputer.set_output(transform="pandas")
            transformed = imputer.fit_transform(df[[column]])[column]
            
            df[column] = transformed.round().astype(int) if is_int else transformed.round(2)

        elif method == "ai":
            numeric_df = df.select_dtypes(include=[np.number])
            if numeric_df.shape[1] > 1:
                imputer = IterativeImputer(estimator=RandomForestRegressor(n_estimators=10, random_state=42), max_iter=10, random_state=42)
                imputer.set_output(transform="pandas")
                imputed_numeric = imputer.fit_transform(numeric_df)
                transformed = imputed_numeric[column]
            else:
                imputer = SimpleImputer(strategy="median")
                imputer.set_output(transform="pandas")
                transformed = imputer.fit_transform(df[[column]])[column]

            df[column] = transformed.round().astype(int) if is_int else transformed.round(2)

    # ==================== CATEGORICAL / TEXT COLUMNS ====================
    elif pd.api.types.is_string_dtype(df[column]) or pd.api.types.is_object_dtype(df[column]):
        if method == "mode":
            imputer = SimpleImputer(strategy="most_frequent")
            imputer.set_output(transform="pandas")
            df[[column]] = imputer.fit_transform(df[[column]])
            
        elif method == "constant":
            imputer = SimpleImputer(strategy="constant", fill_value=custom_fill_value)
            imputer.set_output(transform="pandas")
            df[[column]] = imputer.fit_transform(df[[column]])
            
        elif method == "ai":
            cat_df = df.select_dtypes(include=['object', 'string'])
            encoder = OrdinalEncoder(handle_unknown='use_encoded_value', unknown_value=np.nan)
            encoded_data = encoder.fit_transform(cat_df)

            imputer = KNNImputer(n_neighbors=5)
            imputed_data = np.round(imputer.fit_transform(encoded_data))

            decoded_df = pd.DataFrame(encoder.inverse_transform(imputed_data), columns=cat_df.columns, index=df.index)
            df[column] = decoded_df[column]

    return df

def ColumnRearrangeRenamer(df, action, old_col=None, new_col=None, col1=None, col2=None):
    """Renames a column or swaps two columns."""
    df = df.copy()
    if action == "rename" and old_col in df.columns and new_col:
        df.rename(columns={old_col: new_col}, inplace=True)
        
    elif action == "rearrange" and col1 in df.columns and col2 in df.columns:
        cols = list(df.columns)
        idx1, idx2 = cols.index(col1), cols.index(col2)
        cols[idx1], cols[idx2] = cols[idx2], cols[idx1]
        df = df[cols]
        
    return df

def DeleteDuplicate(df):
    """Drops duplicate rows and returns the cleaned dataframe and count of removed rows."""
    df_clean = df.copy()
    initial_count = len(df_clean)
    df_clean.drop_duplicates(inplace=True)
    dropped_count = initial_count - len(df_clean)
    return df_clean, dropped_count

def EnCoder(df, column, method, target_col=None):
    """Encodes categorical columns based on the selected method."""
    df = df.copy()
    if column not in df.columns:
        return df

    if method == "one-hot":
        ohe = OneHotEncoder(sparse_output=False, handle_unknown="ignore")
        ohe.set_output(transform="pandas")
        encoded_cols = ohe.fit_transform(df[[column]])
        df = pd.concat([df.drop(columns=[column]), encoded_cols], axis=1)
        
    elif method == "ordinal":
        oe = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)
        df[column] = oe.fit_transform(df[[column]])
        
    elif method == "target" and target_col in df.columns:
        te = TargetEncoder(smooth="auto")
        df[column] = te.fit_transform(df[[column]], df[target_col])
        
    elif method == "native":
        df[column] = df[column].astype("category").cat.codes

    return df